import { timingSafeEqual } from 'node:crypto';

export type CronAuthResult = 'ok' | 'not_configured' | 'unauthorized';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Checks a cron request against CRON_SECRET. Accepts the secret as
 * `Authorization: Bearer <secret>` (what Vercel Cron sends) or as an
 * `x-cron-secret` header (what the existing automations cron uses).
 *
 * Fails closed: an unset or empty secret means NO request is authorized.
 */
export function checkCronAuth(
  request: Request,
  secret: string | undefined
): CronAuthResult {
  if (!secret) return 'not_configured';

  const bearer = request.headers.get('authorization');
  const supplied =
    bearer?.startsWith('Bearer ')
      ? bearer.slice('Bearer '.length)
      : request.headers.get('x-cron-secret');

  if (!supplied || !safeEqual(supplied, secret)) return 'unauthorized';
  return 'ok';
}
