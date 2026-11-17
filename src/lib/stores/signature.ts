import crypto from 'node:crypto';

/**
 * Store webhook signatures. Shopify (X-Shopify-Hmac-Sha256) and WooCommerce
 * (X-WC-Webhook-Signature) both send base64(HMAC-SHA256(rawBody, secret)).
 * Verify against the RAW body, in constant time.
 */
export function computeStoreSignature(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
}

export function verifyStoreSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = Buffer.from(computeStoreSignature(rawBody, secret));
  const actual = Buffer.from(signatureHeader.trim());
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/** Random token for the webhook URL path (unguessable, URL-safe). */
export function generatePublicId(): string {
  return crypto.randomBytes(18).toString('base64url');
}

/** A signing secret we generate for WooCommerce (the merchant pastes it in). */
export function generateStoreSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
}
