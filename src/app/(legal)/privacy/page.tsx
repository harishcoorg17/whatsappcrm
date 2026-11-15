import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal/legal-document';
import { PRIVACY_POLICY } from '@/lib/legal/privacy';

export const metadata: Metadata = {
  title: PRIVACY_POLICY.title,
  description: PRIVACY_POLICY.description,
  alternates: { canonical: '/privacy' },
  // The root layout keeps the app out of search results; a privacy policy
  // should be readable and indexable by anyone, including Meta's reviewers.
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return <LegalDocument doc={PRIVACY_POLICY} />;
}
