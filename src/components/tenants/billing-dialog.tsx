'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Interval = 'monthly' | 'yearly';
type PayablePlan = 'starter' | 'growth';

interface Quote {
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
}

interface BillingSummary {
  plan: 'starter' | 'growth' | 'scale';
  status: string;
  isTrialing: boolean;
  isLocked: boolean;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  canManage: boolean;
  limits: { agents: number | null; numbers: number | null };
  usage: { agents: number; numbers: number };
  prices: Record<string, { monthly: Quote | null; yearly: Quote | null }>;
  invoices: Array<{
    id: string;
    amount_paise: number;
    status: string;
    paid_at: string | null;
    plan: string | null;
  }>;
}

interface BillingDialogProps {
  tenant: { slug: string; name: string } | null;
  onClose: () => void;
}

const PLAN_NAMES = { starter: 'Starter', growth: 'Growth', scale: 'Scale' };
const PAYABLE: PayablePlan[] = ['starter', 'growth'];

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function statusLine(b: BillingSummary): string {
  if (b.isTrialing) {
    return `Free trial · ${b.trialDaysLeft} ${b.trialDaysLeft === 1 ? 'day' : 'days'} left`;
  }
  if (b.isLocked) return 'Trial ended · choose a plan to keep adding people';
  if (b.status === 'past_due') return 'Payment failed · update your payment';
  return 'Active';
}

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number | null;
}) {
  const full = limit !== null && used >= limit;
  const percent = limit === null ? 0 : Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className={full ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
          {used} of {limit ?? 'unlimited'}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} used`}
        aria-valuenow={used}
        aria-valuemax={limit ?? undefined}
        className="bg-muted h-2 overflow-hidden rounded-full"
      >
        <div
          className={`h-full rounded-full ${full ? 'bg-amber-500' : 'bg-primary'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Plan, usage against the plan's limits, upgrade, and invoices. Upgrading
 * opens Razorpay's hosted checkout; the plan changes when its webhook arrives.
 */
export function BillingDialog({ tenant, onClose }: BillingDialogProps) {
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<Interval>('monthly');
  const [busyPlan, setBusyPlan] = useState<PayablePlan | null>(null);

  const slug = tenant?.slug ?? null;
  const base = slug ? `/api/tenants/${encodeURIComponent(slug)}/billing` : null;

  const load = useCallback(async () => {
    if (!base) return;
    setError(null);
    try {
      const res = await fetch(base);
      const body = (await res.json().catch(() => ({}))) as BillingSummary & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? 'Could not load billing');
        return;
      }
      setBilling(body);
    } catch {
      setError('Network error');
    }
  }, [base]);

  useEffect(() => {
    setBilling(null);
    void load();
  }, [load]);

  const subscribe = async (plan: PayablePlan) => {
    if (!base) return;
    setBusyPlan(plan);
    try {
      const res = await fetch(`${base}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        toast.error(body.error ?? 'Could not start checkout');
        return;
      }
      window.location.assign(body.url);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyPlan(null);
    }
  };

  const paidActive = billing?.status === 'active' || billing?.status === 'past_due';

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="bg-background text-foreground max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Billing — {tenant?.name}</DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="text-muted-foreground py-6 text-center text-sm">{error}</p>
        ) : !billing ? (
          <p className="text-muted-foreground py-6 text-center text-sm">Loading…</p>
        ) : (
          <div className="space-y-5">
            <div className="border-border bg-card rounded-lg border p-4">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">
                Current plan
              </p>
              <p className="text-lg font-semibold">
                {billing.isTrialing ? 'Growth (trial)' : PLAN_NAMES[billing.plan]}
              </p>
              <p
                className={`text-sm ${billing.isLocked || billing.status === 'past_due' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
              >
                {statusLine(billing)}
              </p>
            </div>

            <div className="space-y-3">
              <UsageBar
                label="Agents (including the owner)"
                used={billing.usage.agents}
                limit={billing.limits.agents}
              />
              <UsageBar
                label="WhatsApp numbers"
                used={billing.usage.numbers}
                limit={billing.limits.numbers}
              />
            </div>

            {billing.canManage && !paidActive && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Choose a plan</h3>
                  <div
                    role="group"
                    aria-label="Billing interval"
                    className="border-border flex rounded-md border p-0.5 text-xs"
                  >
                    {(['monthly', 'yearly'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={interval === value}
                        onClick={() => setInterval(value)}
                        className={`rounded px-2.5 py-1 ${interval === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                      >
                        {value === 'monthly' ? 'Monthly' : 'Yearly · 2 months free'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PAYABLE.map((plan) => {
                    const quote = billing.prices[plan]?.[interval];
                    return (
                      <div
                        key={plan}
                        className="border-border bg-card flex flex-col rounded-lg border p-4"
                      >
                        <p className="font-semibold">{PLAN_NAMES[plan]}</p>
                        {quote && (
                          <>
                            <p className="mt-1 text-xl font-bold">
                              {inr(quote.subtotalPaise)}
                              <span className="text-muted-foreground text-xs font-normal">
                                {interval === 'monthly' ? ' / month' : ' / year'}
                              </span>
                            </p>
                            <p className="text-muted-foreground text-xs">
                              + {inr(quote.gstPaise)} GST (18%)
                            </p>
                          </>
                        )}
                        <Button
                          className="mt-3"
                          size="sm"
                          disabled={busyPlan !== null}
                          onClick={() => void subscribe(plan)}
                        >
                          {busyPlan === plan ? 'Opening checkout…' : `Choose ${PLAN_NAMES[plan]}`}
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-muted-foreground text-xs">
                  Need more than 5 agents or many numbers? The Scale plan is
                  custom. Extra agents are ₹400 a month each.
                </p>
              </div>
            )}

            {!billing.canManage && !paidActive && (
              <p className="text-muted-foreground text-sm">
                Only the workspace owner can change the plan.
              </p>
            )}

            <div>
              <h3 className="mb-2 text-sm font-semibold">Invoices</h3>
              {billing.invoices.length === 0 ? (
                <p className="text-muted-foreground text-sm">No payments yet.</p>
              ) : (
                <ul className="divide-border border-border divide-y rounded-lg border">
                  {billing.invoices.map((invoice) => (
                    <li
                      key={invoice.id}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span>
                        {invoice.paid_at
                          ? new Date(invoice.paid_at).toLocaleDateString('en-IN')
                          : '—'}
                        {invoice.plan && (
                          <span className="text-muted-foreground">
                            {' '}
                            · {invoice.plan}
                          </span>
                        )}
                      </span>
                      <span className="font-medium">{inr(invoice.amount_paise)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
