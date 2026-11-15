/**
 * Who the legal pages speak for. Everything that must be filled in by the
 * business (not guessed) comes from env vars, so it can be set without a code
 * change. Leave an optional one unset and its line is simply left out.
 *
 *   NEXT_PUBLIC_LEGAL_ENTITY   registered name of the company operating ConverMesh
 *   NEXT_PUBLIC_LEGAL_ADDRESS  registered address
 *   NEXT_PUBLIC_LEGAL_EMAIL    address for privacy requests and legal notices
 */

export const LEGAL = {
  product: 'ConverMesh',
  productFull: 'ConverMesh WhatsApp CRM',
  // Fixed on purpose: the policy must name the real domain, not whatever
  // NEXT_PUBLIC_SITE_URL is set to in a dev or preview environment.
  siteUrl: 'https://convermesh.com',
  operator: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? 'NovaCompass Solutions',
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS ?? null,
  email: process.env.NEXT_PUBLIC_LEGAL_EMAIL ?? null,
  /** Update whenever the privacy policy or terms change. */
  lastUpdated: '15 November 2026',
  governingLaw: 'India',
} as const;

export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  dataDeletion: '/privacy#data-deletion',
} as const;
