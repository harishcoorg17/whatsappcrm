import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveLimits, type PlanLimits } from './plans';

export const BILLING_COLUMNS =
  'plan, subscription_status, trial_ends_at, extra_agents, billing_interval, current_period_end, razorpay_subscription_id';

export interface TenantBillingRow {
  plan: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  extra_agents: number | null;
  billing_interval: string | null;
  current_period_end: string | null;
  razorpay_subscription_id: string | null;
}

/**
 * Load a tenant's billing row. Returns null when the columns are unreadable
 * (for example migration 038 has not been applied yet): callers then skip
 * enforcement instead of locking every tenant out of their own team.
 */
export async function loadTenantBilling(
  db: SupabaseClient,
  tenantId: string
): Promise<TenantBillingRow | null> {
  const { data, error } = await db
    .from('crm_tenants')
    .select(BILLING_COLUMNS)
    .eq('id', tenantId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn('[billing] could not load plan:', error.message);
    return null;
  }
  return data as TenantBillingRow;
}

export function limitsFromRow(row: TenantBillingRow): PlanLimits {
  return resolveLimits({
    plan: row.plan,
    status: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    extraAgents: row.extra_agents,
  });
}

/** Limits for a tenant, or null when billing is not set up (no enforcement). */
export async function loadTenantLimits(
  db: SupabaseClient,
  tenantId: string
): Promise<PlanLimits | null> {
  const row = await loadTenantBilling(db, tenantId);
  return row ? limitsFromRow(row) : null;
}
