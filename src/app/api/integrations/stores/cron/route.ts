import { NextResponse } from 'next/server';
import { createStoreDeps } from '@/lib/stores/deps';
import { processDueAbandonedCarts } from '@/lib/stores/handle-webhook';

/**
 * Fire abandoned-cart automations whose wait time is over and whose checkout
 * was not completed. Hit it every few minutes with the same shared secret as
 * the other crons: header `x-cron-secret: $AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (request.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await processDueAbandonedCarts(createStoreDeps()));
  } catch (err) {
    console.error('[integrations/stores/cron] failed:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
