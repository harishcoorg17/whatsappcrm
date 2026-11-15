import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Request signing for outbound webhooks (same idea as Stripe's):
 *
 *   X-ConverMesh-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
 *
 * where the HMAC is over `${t}.${rawBody}` using the endpoint's secret. The
 * receiver recomputes it and compares in constant time, and rejects stale
 * timestamps so a captured request cannot be replayed later.
 */

export const SIGNATURE_HEADER = 'X-ConverMesh-Signature';
export const EVENT_HEADER = 'X-ConverMesh-Event';
export const DELIVERY_HEADER = 'X-ConverMesh-Delivery';
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

function computeSignature(
  secret: string,
  timestamp: number,
  body: string
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

export function buildSignatureHeader(
  secret: string,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  return `t=${nowSeconds},v1=${computeSignature(secret, nowSeconds, body)}`;
}

/** What a receiver does. Exported so it is tested and can be copied into docs. */
export function verifySignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {}
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [key, ...rest] = p.trim().split('=');
      return [key, rest.join('=')];
    })
  );
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) return false;

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = Buffer.from(
    computeSignature(secret, timestamp, body),
    'hex'
  );
  let given: Buffer;
  try {
    given = Buffer.from(provided, 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
