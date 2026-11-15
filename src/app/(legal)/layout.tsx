import type { ReactNode } from 'react';
import { LandingFooter, LandingHeader } from '@/components/landing/sections';

/** Public pages (privacy policy, terms): same header and footer as the landing page. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LandingHeader />
      <main>{children}</main>
      <LandingFooter />
    </>
  );
}
