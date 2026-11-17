import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingInterval, PlanId, SubscriptionStatus } from './plans';

/**
 * Razorpay helpers. No SDK: three REST calls and an HMAC check. Every key and
 * plan id comes from the environment.
 *
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   API credentials
 *   RAZORPAY_WEBHOOK_SECRET                the secret set on the webhook
 *   RAZORPAY_PLAN_<STARTER|GROWTH>_<MONTHLY|YEARLY>
 *                                          Razorpay plan ids (rzp_plan_...)
 */

const API_BASE = 'https://api.razorpay.com/v1';
const REQUEST_TIMEOUT_MS = 15_000;

export type PayablePlan = Exclude<PlanId, 'scale'>;

export function isPayablePlan(value: unknown): value is PayablePlan {
  return value === 'starter' || value === 'growth';
}

export function isInterval(value: unknown): value is BillingInterval {
  return value === 'monthly' || value === 'yearly';
}

export function razorpayPlanId(
  plan: PayablePlan,
  interval: BillingInterval,
  env: Record<string, string | undefined> = process.env
): string | null {
  const key = `RAZORPAY_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}`;
  return env[key]?.trim() || null;
}

/** Constant-time check of Razorpay's X-Razorpay-Signature (HMAC-SHA256 hex). */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string | undefined
): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export interface CreatedSubscription {
  id: string;
  short_url: string;
  status: string;
}

export class RazorpayError extends Error {}

/** Create a subscription for the hosted checkout. */
export async function createSubscription(input: {
  planId: string;
  /** How many billing cycles to run before it ends. */
  totalCount: number;
  notes: Record<string, string>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<CreatedSubscription> {
  const env = input.env ?? process.env;
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new RazorpayError('Razorpay is not configured');
  }
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch(`${API_BASE}/subscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify({
      plan_id: input.planId,
      total_count: input.totalCount,
      customer_notify: 1,
      notes: input.notes,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    short_url?: string;
    status?: string;
    error?: { description?: string };
  };
  if (!res.ok || !body.id || !body.short_url) {
    throw new RazorpayError(
      body.error?.description ?? `Razorpay returned ${res.status}`
    );
  }
  return { id: body.id, short_url: body.short_url, status: body.status ?? '' };
}

/** Billing cycles to schedule: ten years either way, renewed by Razorpay. */
export function totalCountFor(interval: BillingInterval): number {
  return interval === 'yearly' ? 10 : 120;
}

// ── Webhook payloads ────────────────────────────────────────────────────────

interface SubscriptionEntity {
  id: string;
  status?: string;
  customer_id?: string | null;
  current_end?: number | null;
  notes?: Record<string, string> | unknown[] | null;
}

interface PaymentEntity {
  id: string;
  amount: number;
  currency?: string;
  invoice_id?: string | null;
  tax?: number | null;
  created_at?: number;
  notes?: Record<string, string> | unknown[] | null;
}

export interface RazorpayEvent {
  event: string;
  payload?: {
    subscription?: { entity?: SubscriptionEntity };
    payment?: { entity?: PaymentEntity };
  };
}

export interface TenantUpdate {
  subscription_status?: SubscriptionStatus;
  plan?: PayablePlan;
  billing_interval?: BillingInterval;
  razorpay_customer_id?: string;
  razorpay_subscription_id?: string;
  current_period_end?: string;
}

export interface InvoiceInsert {
  razorpay_payment_id: string;
  razorpay_invoice_id: string | null;
  razorpay_subscription_id: string | null;
  amount_paise: number;
  tax_paise: number;
  currency: string;
  paid_at: string | null;
}

export interface EventEffect {
  /** crm_tenants.id from the subscription notes. */
  tenantId: string | null;
  subscriptionId: string | null;
  update: TenantUpdate;
  invoice: InvoiceInsert | null;
}

const toIso = (seconds: number | null | undefined) =>
  typeof seconds === 'number'
    ? new Date(seconds * 1000).toISOString()
    : undefined;

/** Razorpay sends `notes: []` when empty, so only accept a real object. */
const readNotes = (notes: unknown): Record<string, string> =>
  notes && typeof notes === 'object' && !Array.isArray(notes)
    ? (notes as Record<string, string>)
    : {};

/**
 * Translate one webhook event into what we store. Pure so the status
 * transitions are unit tested. Unknown events return null (acknowledged,
 * ignored).
 */
export function interpretEvent(event: RazorpayEvent): EventEffect | null {
  const subscription = event.payload?.subscription?.entity;
  const payment = event.payload?.payment?.entity;
  const notes = readNotes(subscription?.notes);
  const update: TenantUpdate = {};

  if (isPayablePlan(notes.plan)) update.plan = notes.plan;
  if (isInterval(notes.interval)) update.billing_interval = notes.interval;
  if (subscription?.id) update.razorpay_subscription_id = subscription.id;
  if (subscription?.customer_id) {
    update.razorpay_customer_id = subscription.customer_id;
  }
  const periodEnd = toIso(subscription?.current_end);
  if (periodEnd) update.current_period_end = periodEnd;

  const base = {
    tenantId: notes.tenant_id ?? null,
    subscriptionId: subscription?.id ?? null,
    invoice: null as InvoiceInsert | null,
  };

  switch (event.event) {
    case 'subscription.activated':
    case 'subscription.resumed':
      return { ...base, update: { ...update, subscription_status: 'active' } };
    case 'subscription.charged': {
      const invoice = payment
        ? {
            razorpay_payment_id: payment.id,
            razorpay_invoice_id: payment.invoice_id ?? null,
            razorpay_subscription_id: subscription?.id ?? null,
            amount_paise: payment.amount,
            tax_paise: payment.tax ?? 0,
            currency: payment.currency ?? 'INR',
            paid_at: toIso(payment.created_at) ?? new Date().toISOString(),
          }
        : null;
      return {
        ...base,
        update: { ...update, subscription_status: 'active' },
        invoice,
      };
    }
    case 'subscription.pending':
    case 'subscription.halted':
      return {
        ...base,
        update: { ...update, subscription_status: 'past_due' },
      };
    case 'subscription.cancelled':
      return {
        ...base,
        update: { ...update, subscription_status: 'canceled' },
      };
    case 'subscription.completed':
    case 'subscription.expired':
      return { ...base, update: { ...update, subscription_status: 'expired' } };
    default:
      return null;
  }
}
