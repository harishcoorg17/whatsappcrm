import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { MAX_DESCRIPTION_LENGTH, parseEvents } from '@/lib/webhooks/events';
import { generateWebhookSecret } from '@/lib/webhooks/signing';
import { assertSafeWebhookUrl } from '@/lib/webhooks/url-safety';
import { encrypt } from '@/lib/whatsapp/encryption';

/**
 * One outbound webhook endpoint.
 *
 *   GET    /api/tenants/[slug]/webhooks/[id]   the endpoint + its recent deliveries
 *   PATCH  /api/tenants/[slug]/webhooks/[id]   { url?, description?, events?,
 *                                              enabled?, rotateSecret? }
 *   DELETE /api/tenants/[slug]/webhooks/[id]
 *
 * Turning an endpoint back on clears its failure count. A rotated secret is
 * returned once, in the PATCH response.
 */

type Context = { params: Promise<{ slug: string; id: string }> };

const ENDPOINT_COLUMNS =
  'id, url, description, events, enabled, consecutive_failures, last_success_at, last_failure_at, disabled_reason, created_at';
const RECENT_DELIVERIES = 20;

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data: endpoint } = await auth.db
      .from('crm_webhook_endpoints')
      .select(ENDPOINT_COLUMNS)
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .maybeSingle();
    if (!endpoint) return problem('Webhook not found', 404).response;

    const { data: deliveries } = await auth.db
      .from('crm_webhook_deliveries')
      .select(
        'id, event_type, status, http_status, error, attempt, duration_ms, created_at'
      )
      .eq('endpoint_id', id)
      .order('created_at', { ascending: false })
      .limit(RECENT_DELIVERIES);

    return NextResponse.json({ endpoint, deliveries: deliveries ?? [] });
  } catch (error) {
    console.error('[tenants/webhooks] unexpected error:', error);
    return problem('Could not load the webhook', 500).response;
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data: existing } = await auth.db
      .from('crm_webhook_endpoints')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .maybeSingle();
    if (!existing) return problem('Webhook not found', 404).response;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const updates: Record<string, unknown> = {};

    if (body.url !== undefined) {
      const safe = await assertSafeWebhookUrl(
        typeof body.url === 'string' ? body.url : ''
      );
      if (!safe.ok) return problem(safe.error, 400).response;
      updates.url = safe.url.toString();
    }
    if (body.events !== undefined) {
      const events = parseEvents(body.events);
      if (!events.ok) return problem(events.error, 400).response;
      updates.events = events.events;
    }
    if (body.description !== undefined) {
      const description =
        typeof body.description === 'string' ? body.description.trim() : '';
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        return problem(
          `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`,
          400
        ).response;
      }
      updates.description = description || null;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return problem('enabled must be true or false', 400).response;
      }
      updates.enabled = body.enabled;
      if (body.enabled) {
        updates.consecutive_failures = 0;
        updates.disabled_reason = null;
      }
    }
    let newSecret: string | null = null;
    if (body.rotateSecret === true) {
      newSecret = generateWebhookSecret();
      updates.secret_enc = encrypt(newSecret);
    }

    if (Object.keys(updates).length === 0) {
      return problem('Nothing to change', 400).response;
    }

    const { data, error } = await auth.db
      .from('crm_webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .select(ENDPOINT_COLUMNS)
      .single();
    if (error || !data) {
      console.error('[tenants/webhooks] update failed:', error?.message);
      return problem('Could not update the webhook', 500).response;
    }

    return NextResponse.json({
      endpoint: data,
      ...(newSecret ? { secret: newSecret } : {}),
    });
  } catch (error) {
    console.error('[tenants/webhooks] unexpected error:', error);
    return problem('Could not update the webhook', 500).response;
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data: existing } = await auth.db
      .from('crm_webhook_endpoints')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .maybeSingle();
    if (!existing) return problem('Webhook not found', 404).response;

    const { error } = await auth.db
      .from('crm_webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id);
    if (error) {
      console.error('[tenants/webhooks] delete failed:', error.message);
      return problem('Could not delete the webhook', 500).response;
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('[tenants/webhooks] unexpected error:', error);
    return problem('Could not delete the webhook', 500).response;
  }
}
