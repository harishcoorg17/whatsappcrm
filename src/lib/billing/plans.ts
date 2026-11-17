/**
 * Plan limits and feature gates. Pure: no I/O, so every rule is unit tested.
 * Marketing copy lives in components/landing/pricing-content.ts; the numbers
 * here are the ones the app enforces and must match it.
 */

export type PlanId = 'starter' | 'growth' | 'scale';
export type BillingInterval = 'monthly' | 'yearly';
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired';
export type Feature = 'flows' | 'humanHandoff' | 'pipelines';

export const TRIAL_DAYS = 14;
/** Yearly billing charges ten months and gives two free. */
export const YEARLY_MONTHS_CHARGED = 10;
export const GST_RATE = 0.18;
export const EXTRA_AGENT_MONTHLY_INR = 400;

/** A null limit means unlimited. */
interface PlanDefinition {
  agents: number | null;
  numbers: number | null;
  features: ReadonlySet<Feature>;
  monthlyInr: number | null;
}

const GROWTH_FEATURES: ReadonlySet<Feature> = new Set([
  'flows',
  'humanHandoff',
  'pipelines',
]);

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: { agents: 3, numbers: 1, features: new Set(), monthlyInr: 1999 },
  growth: {
    agents: 5,
    numbers: 2,
    features: GROWTH_FEATURES,
    monthlyInr: 4999,
  },
  scale: {
    agents: null,
    numbers: null,
    features: GROWTH_FEATURES,
    monthlyInr: null,
  },
};

export interface TenantBilling {
  /** Raw crm_tenants.plan; unknown values (e.g. 'enterprise') are tolerated. */
  plan: string | null;
  status: SubscriptionStatus | string | null;
  trialEndsAt: string | Date | null;
  extraAgents?: number | null;
}

export interface PlanLimits {
  /** The plan whose rules apply right now. */
  plan: PlanId;
  agents: number | null;
  numbers: number | null;
  features: ReadonlySet<Feature>;
  /** True when the trial has run out and no subscription is active. */
  isLocked: boolean;
  isTrialing: boolean;
  trialDaysLeft: number | null;
}

const MS_PER_DAY = 86_400_000;

export function normalizePlan(raw: string | null | undefined): PlanId {
  if (raw === 'growth' || raw === 'scale') return raw;
  if (raw === 'enterprise') return 'scale';
  return 'starter';
}

export function trialDaysLeft(
  trialEndsAt: string | Date | null,
  now: Date
): number {
  if (!trialEndsAt) return 0;
  const end = new Date(trialEndsAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - now.getTime()) / MS_PER_DAY));
}

/**
 * The limits that apply to a tenant right now.
 *  - trialing (clock running): Growth limits
 *  - trial over with no subscription, or canceled/expired: Starter limits,
 *    `isLocked` so the UI can say why Growth features are gone
 *  - active / past_due: the paid plan (past_due keeps access while Razorpay
 *    retries the charge)
 */
export function resolveLimits(
  billing: TenantBilling,
  now: Date = new Date()
): PlanLimits {
  const status = billing.status ?? 'trialing';
  const extra = Math.max(0, billing.extraAgents ?? 0);
  const withExtra = (agents: number | null) =>
    agents === null ? null : agents + extra;

  if (status === 'trialing') {
    const daysLeft = trialDaysLeft(billing.trialEndsAt, now);
    if (daysLeft > 0) {
      const growth = PLANS.growth;
      return {
        plan: 'growth',
        agents: growth.agents,
        numbers: growth.numbers,
        features: growth.features,
        isLocked: false,
        isTrialing: true,
        trialDaysLeft: daysLeft,
      };
    }
    return lockedLimits();
  }

  if (status === 'active' || status === 'past_due') {
    const plan = normalizePlan(billing.plan);
    const def = PLANS[plan];
    return {
      plan,
      agents: withExtra(def.agents),
      numbers: def.numbers,
      features: def.features,
      isLocked: false,
      isTrialing: false,
      trialDaysLeft: null,
    };
  }

  return lockedLimits();
}

function lockedLimits(): PlanLimits {
  const starter = PLANS.starter;
  return {
    plan: 'starter',
    agents: starter.agents,
    numbers: starter.numbers,
    features: starter.features,
    isLocked: true,
    isTrialing: false,
    trialDaysLeft: null,
  };
}

export interface LimitCheck {
  allowed: boolean;
  /** Plain-language reason, safe to show the user. Empty when allowed. */
  message: string;
  limit: number | null;
  used: number;
}

const PLAN_NAME: Record<PlanId, string> = {
  starter: 'Starter',
  growth: 'Growth',
  scale: 'Scale',
};

function checkCount(
  noun: string,
  nounPlural: string,
  limits: PlanLimits,
  limit: number | null,
  used: number
): LimitCheck {
  if (limit === null || used < limit) {
    return { allowed: true, message: '', limit, used };
  }
  const where = limits.isLocked
    ? 'Your trial has ended. Choose a plan to add more'
    : `Your ${PLAN_NAME[limits.plan]} plan includes ${limit} ${limit === 1 ? noun : nounPlural}. Upgrade to add more`;
  return { allowed: false, message: `${where}.`, limit, used };
}

/** `used` counts everyone with a seat: the owner plus team members. */
export function canAddAgent(limits: PlanLimits, used: number): LimitCheck {
  return checkCount('agent', 'agents', limits, limits.agents, used);
}

export function canAddNumber(limits: PlanLimits, used: number): LimitCheck {
  return checkCount(
    'WhatsApp number',
    'WhatsApp numbers',
    limits,
    limits.numbers,
    used
  );
}

export function canUseFeature(limits: PlanLimits, feature: Feature): boolean {
  return limits.features.has(feature);
}

export interface PriceQuote {
  /** Subtotal in paise before GST. */
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
  /** Months of the monthly price that are charged for the interval. */
  monthsCharged: number;
}

/** Price for a plan and interval, with 18% GST. Null for custom plans. */
export function quotePrice(
  plan: PlanId,
  interval: BillingInterval
): PriceQuote | null {
  const monthly = PLANS[plan].monthlyInr;
  if (monthly === null) return null;
  const monthsCharged = interval === 'yearly' ? YEARLY_MONTHS_CHARGED : 1;
  const subtotalPaise = monthly * monthsCharged * 100;
  const gstPaise = Math.round(subtotalPaise * GST_RATE);
  return {
    subtotalPaise,
    gstPaise,
    totalPaise: subtotalPaise + gstPaise,
    monthsCharged,
  };
}
