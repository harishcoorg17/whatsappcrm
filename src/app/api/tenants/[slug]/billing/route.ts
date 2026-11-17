import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { PLANS, quotePrice, type PlanId } from '@/lib/billing/plans';
import { limitsFromRow, loadTenantBilling } from '@/lib/billing/server';

/**
 *   GET /api/tenants/[slug]/billing   plan, status, usage and recent invoices
 *
 * Allowed for the owner, platform admins and team admins.
 */

type Context = { params: Promise<{ slug: string }> };

const INVOICE_LIMIT = 12;

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const billing = await loadTenantBilling(auth.db, auth.tenant.id);
    if (!billing) {
      return problem('Billing is not set up yet', 503).response;
    }
    const limits = limitsFromRow(billing);

    const [{ count: memberCount }, { count: numberCount }, invoices] =
      await Promise.all([
        auth.db
          .from('crm_tenant_members')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenant.id),
        auth.db
          .from('crm_tenant_numbers')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenant.id),
        auth.db
          .from('crm_invoices')
          .select('id, amount_paise, currency, status, paid_at, plan')
          .eq('tenant_id', auth.tenant.id)
          .order('created_at', { ascending: false })
          .limit(INVOICE_LIMIT),
      ]);

    const prices = Object.fromEntries(
      (Object.keys(PLANS) as PlanId[]).map((id) => [
        id,
        {
          monthly: quotePrice(id, 'monthly'),
          yearly: quotePrice(id, 'yearly'),
        },
      ])
    );

    return NextResponse.json({
      plan: limits.plan,
      paidPlan: billing.plan,
      status: billing.subscription_status,
      interval: billing.billing_interval,
      isTrialing: limits.isTrialing,
      isLocked: limits.isLocked,
      trialDaysLeft: limits.trialDaysLeft,
      trialEndsAt: billing.trial_ends_at,
      currentPeriodEnd: billing.current_period_end,
      canManage: auth.level === 'owner',
      limits: { agents: limits.agents, numbers: limits.numbers },
      usage: {
        agents: (memberCount ?? 0) + (auth.tenant.owner_user_id ? 1 : 0),
        numbers: numberCount ?? 0,
      },
      prices,
      invoices: invoices.data ?? [],
    });
  } catch (error) {
    console.error('[tenants/billing] unexpected error:', error);
    return problem('Could not load billing', 500).response;
  }
}
