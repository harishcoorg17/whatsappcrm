import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import {
  createSubscription,
  isInterval,
  isPayablePlan,
  razorpayPlanId,
  RazorpayError,
  totalCountFor,
} from '@/lib/billing/razorpay';

/**
 *   POST /api/tenants/[slug]/billing/subscribe   { plan, interval }
 *
 * Creates a Razorpay subscription and returns its hosted checkout link
 * ({ url }). The plan only changes when Razorpay's webhook confirms payment.
 * Owner or platform admin only. Scale is custom-priced and not sold here.
 */

type Context = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug);
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(
      `tenant-billing:${auth.userId}`,
      RATE_LIMITS.tenantSelf
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!isPayablePlan(body.plan)) {
      return problem('Choose the Starter or Growth plan', 400).response;
    }
    if (!isInterval(body.interval)) {
      return problem('Choose monthly or yearly billing', 400).response;
    }

    const { data: current } = await auth.db
      .from('crm_tenants')
      .select('subscription_status')
      .eq('id', auth.tenant.id)
      .maybeSingle();
    if (current?.subscription_status === 'active') {
      return problem(
        'This workspace already has an active subscription. Contact support to change plan.',
        409
      ).response;
    }

    const planId = razorpayPlanId(body.plan, body.interval);
    if (!planId) {
      console.error('[tenants/billing] no Razorpay plan id configured');
      return problem('Billing is not available yet', 503).response;
    }

    const subscription = await createSubscription({
      planId,
      totalCount: totalCountFor(body.interval),
      notes: {
        tenant_id: auth.tenant.id,
        plan: body.plan,
        interval: body.interval,
      },
    });

    // Remember it now so the webhook can match it (and ignore older ones).
    const { error } = await auth.db
      .from('crm_tenants')
      .update({ razorpay_subscription_id: subscription.id })
      .eq('id', auth.tenant.id);
    if (error) {
      console.error('[tenants/billing] save failed:', error.message);
      return problem('Could not start the subscription', 500).response;
    }

    return NextResponse.json({ url: subscription.short_url }, { status: 201 });
  } catch (error) {
    if (error instanceof RazorpayError) {
      console.error('[tenants/billing] razorpay failed:', error.message);
      return problem('Could not reach the payment provider', 502).response;
    }
    console.error('[tenants/billing] unexpected error:', error);
    return problem('Could not start the subscription', 500).response;
  }
}
