import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_ENDPOINTS_PER_TENANT,
  parseEvents,
} from '@/lib/webhooks/events';
import { generateWebhookSecret } from '@/lib/webhooks/signing';
import { assertSafeWebhookUrl } from '@/lib/webhooks/url-safety';
import { encrypt } from '@/lib/whatsapp/encryption';

/**
 * A tenant's outbound webhook endpoints.
 *
 *   GET  /api/tenants/[slug]/webhooks   list (never secrets)
 *   POST /api/tenants/[slug]/webhooks   create { url, description?, events? };
 *                                       the signing secret is in the response
 *                                       ONCE and cannot be read back later
 *
 * Allowed for the tenant's owner, platform admins and team admins.
 */

type Context = { params: Promise<{ slug: string }> };

const ENDPOINT_COLUMNS =
  'id, url, description, events, enabled, consecutive_failures, last_success_at, last_failure_at, disabled_reason, created_at';

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db
      .from('crm_webhook_endpoints')
      .select(ENDPOINT_COLUMNS)
      .eq('tenant_id', auth.tenant.id)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[tenants/webhooks] list failed:', error.message);
      return problem(
        'Could not load webhooks. Has the latest migration been applied?',
        500
      ).response;
    }
    return NextResponse.json({ endpoints: data ?? [] });
  } catch (error) {
    console.error('[tenants/webhooks] unexpected error:', error);
    return problem('Could not load webhooks', 500).response;
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(
      `tenant-webhooks:${auth.userId}`,
      RATE_LIMITS.tenantSelf
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const safe = await assertSafeWebhookUrl(
      typeof body.url === 'string' ? body.url : ''
    );
    if (!safe.ok) return problem(safe.error, 400).response;

    const events = parseEvents(body.events);
    if (!events.ok) return problem(events.error, 400).response;

    const description =
      typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return problem(
        `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`,
        400
      ).response;
    }

    const { count } = await auth.db
      .from('crm_webhook_endpoints')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenant.id);
    if ((count ?? 0) >= MAX_ENDPOINTS_PER_TENANT) {
      return problem(
        `A tenant can have at most ${MAX_ENDPOINTS_PER_TENANT} webhooks`,
        400
      ).response;
    }

    const secret = generateWebhookSecret();
    const { data, error } = await auth.db
      .from('crm_webhook_endpoints')
      .insert({
        tenant_id: auth.tenant.id,
        url: safe.url.toString(),
        description: description || null,
        secret_enc: encrypt(secret),
        events: events.events,
        created_by: auth.userId,
      })
      .select(ENDPOINT_COLUMNS)
      .single();
    if (error || !data) {
      console.error('[tenants/webhooks] create failed:', error?.message);
      return problem('Could not create the webhook', 500).response;
    }

    return NextResponse.json({ endpoint: data, secret }, { status: 201 });
  } catch (error) {
    console.error('[tenants/webhooks] unexpected error:', error);
    return problem('Could not create the webhook', 500).response;
  }
}
