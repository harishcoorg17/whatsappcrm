import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal/legal-document';
import { TERMS_OF_SERVICE } from '@/lib/legal/terms';

export const metadata: Metadata = {
  title: TERMS_OF_SERVICE.title,
  description: TERMS_OF_SERVICE.description,
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return <LegalDocument doc={TERMS_OF_SERVICE} />;
}
