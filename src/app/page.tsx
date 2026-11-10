import type { Metadata } from 'next';
import {
  Benefits,
  Comparison,
  Ease,
  FinalCta,
  Hero,
  HowItWorks,
  LandingFooter,
  LandingHeader,
} from '@/components/landing/sections';

export const metadata: Metadata = {
  title: 'WhatsApp team inbox, pipelines and automations',
  description:
    'Connect your WhatsApp Business number in minutes. Shared inbox, lead pipelines, broadcasts and automations on the official WhatsApp Business Platform.',
};

export default function HomePage() {
  return (
    <>
      <LandingHeader />
      <main>
        <Hero />
        <HowItWorks />
        <Benefits />
        <Comparison />
        <Ease />
        <FinalCta />
      </main>
      <LandingFooter />
    </>
  );
}
