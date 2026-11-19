import type { Metadata } from 'next';
import { LandingFooter, LandingHeader } from '@/components/landing/sections';
import { PricingPlans } from '@/components/landing/pricing-section';
import { PRICING_FAQ } from '@/components/landing/pricing-content';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple per-team pricing for ConverMesh CRM. Shared inbox, automations, chatbot flows and human handoff. Meta message fees at cost.',
};

export default function PricingPage() {
  return (
    <>
      <LandingHeader />
      <main>
        <PricingPlans />
        <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight">
            Questions
          </h2>
          <dl className="mt-8 space-y-6">
            {PRICING_FAQ.map((item) => (
              <div key={item.q}>
                <dt className="font-medium">{item.q}</dt>
                <dd className="text-muted-foreground mt-1 text-sm">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}
