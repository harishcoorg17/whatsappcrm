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
  title: 'Team inbox, pipelines and automations for customer chats',
  description:
    'Connect your business number in minutes. Shared inbox, lead pipelines, broadcasts and automations. Integrates with the WhatsApp Business Platform.',
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
