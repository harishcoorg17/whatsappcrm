import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkCronAuth } from '@/lib/broadcasts/scheduler/cron-auth';
import { runScheduledBroadcasts } from '@/lib/broadcasts/scheduler/run';

// A run stops starting new batches at 45s (DEFAULT_TIME_BUDGET_MS).
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Sends scheduled broadcasts that are due. Triggered every minute by Vercel
 * Cron (see vercel.json), which sends `Authorization: Bearer $CRON_SECRET`.
 * Fails closed when CRON_SECRET is unset.
 */
export async function GET(request: Request) {
  const auth = checkCronAuth(request, process.env.CRON_SECRET);
  if (auth === 'not_configured') {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await runScheduledBroadcasts({ db: supabaseAdmin() });
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[broadcast-cron] run failed:', error);
    return NextResponse.json({ error: 'cron run failed' }, { status: 500 });
  }
}
