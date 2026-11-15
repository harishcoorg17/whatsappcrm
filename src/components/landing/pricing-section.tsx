'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ANNUAL_MONTHS_CHARGED,
  EXTRA_AGENT_PRICE,
  PRICING_PLANS,
} from './pricing-content';

const inr = new Intl.NumberFormat('en-IN');

export function PricingPlans() {
  const [annual, setAnnual] = useState(false);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-primary text-sm font-semibold tracking-wider uppercase">
          Pricing
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Simple plans for every team
        </h1>
        <p className="text-muted-foreground mt-4 text-base">
          Pay for your team, not for every contact. WhatsApp message fees are
          passed through at Meta’s rate with no markup.
        </p>
      </div>

      <div
        className="border-border mx-auto mt-8 flex w-fit rounded-full border p-1 text-sm"
        role="group"
        aria-label="Billing period"
      >
        {[
          { label: 'Monthly', value: false },
          { label: 'Yearly · 2 months free', value: true },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            aria-pressed={annual === opt.value}
            onClick={() => setAnnual(opt.value)}
            className={cn(
              'rounded-full px-4 py-1.5 font-medium transition-colors',
              annual === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {PRICING_PLANS.map((plan) => {
          const perMonth =
            plan.monthly === null
              ? null
              : annual
                ? Math.round((plan.monthly * ANNUAL_MONTHS_CHARGED) / 12)
                : plan.monthly;
          return (
            <div
              key={plan.id}
              className={cn(
                'border-border bg-card flex flex-col rounded-xl border p-6',
                plan.highlighted && 'border-primary ring-primary/30 ring-2'
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                {plan.highlighted ? (
                  <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                    Most popular
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1 text-sm">{plan.blurb}</p>
              <p className="mt-5">
                {perMonth === null ? (
                  <span className="text-3xl font-bold">Let’s talk</span>
                ) : (
                  <>
                    <span className="text-3xl font-bold">
                      ₹{inr.format(perMonth)}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      {' '}
                      / month + GST
                    </span>
                  </>
                )}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {plan.agents} · {plan.numbers}
              </p>
              <ul className="mt-6 flex-1 space-y-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check
                      className="text-primary mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                render={
                  <Link href={plan.monthly === null ? '/login' : '/signup'} />
                }
                variant={plan.highlighted ? 'default' : 'outline'}
                size="lg"
                className="mt-6"
              >
                {plan.monthly === null ? 'Contact us' : 'Start free trial'}
              </Button>
            </div>
          );
        })}
      </div>

      <p className="text-muted-foreground mt-6 text-center text-sm">
        Need more agents? Add them for ₹{EXTRA_AGENT_PRICE} per agent per month
        on Starter and Growth.
      </p>
    </section>
  );
}
