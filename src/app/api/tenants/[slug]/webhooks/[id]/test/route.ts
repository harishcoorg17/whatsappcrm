import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import {
  deliverToEndpoint,
  type WebhookEndpoint,
} from '@/lib/webhooks/deliver';
import { buildEnvelope } from '@/lib/webhooks/events';

/**
 * POST /api/tenants/[slug]/webhooks/[id]/test
 *
 * Sends a signed "ping" event to the endpoint right now (one attempt, no
 * retries) and reports what the receiver answered, so a tenant can check their
 * URL and signature code before real events arrive.
 */

type Context = { params: Promise<{ slug: string; id: string }> };

export async function POST(_request: NextRequest, context: Context) {
  try {
    const { slug, id } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(
      `tenant-webhook-test:${auth.userId}`,
      RATE_LIMITS.tenantSelf
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data } = await auth.db
      .from('crm_webhook_endpoints')
      .select('id, tenant_id, url, secret_enc, events, consecutive_failures')
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
      .maybeSingle();
    if (!data) return problem('Webhook not found', 404).response;

    const envelope = buildEnvelope('ping', auth.tenant.id, {
      message: 'This is a test event from ConverMesh.',
    });
    const result = await deliverToEndpoint(
      auth.db,
      data as WebhookEndpoint,
      envelope,
      { maxAttempts: 1 }
    );

    return NextResponse.json({
      ok: result.ok,
      status: result.status ?? null,
      error: result.error ?? null,
    });
  } catch (error) {
    console.error('[tenants/webhooks] test failed:', error);
    return problem('Could not send the test event', 500).response;
  }
}
