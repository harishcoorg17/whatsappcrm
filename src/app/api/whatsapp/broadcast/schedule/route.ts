import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateScheduledAt } from '@/lib/broadcasts/scheduler/schedule-time';

interface Body {
  broadcast_id?: unknown;
  action?: unknown;
  scheduled_at?: unknown;
}

/**
 * Cancel or reschedule a broadcast that has not been claimed yet.
 *
 * Both are single conditional UPDATEs guarded by `status = 'scheduled'`: the
 * cron flips a broadcast to 'sending' atomically when it claims it, so once a
 * run has started nothing here can change it (409).
 *
 *   POST { broadcast_id, action: 'cancel' }                      -> back to draft
 *   POST { broadcast_id, action: 'reschedule', scheduled_at }    -> new time
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { broadcast_id, action } = body;
  if (typeof broadcast_id !== 'string' || !broadcast_id) {
    return NextResponse.json(
      { error: 'broadcast_id is required' },
      { status: 400 }
    );
  }

  let patch: { scheduled_at: string | null; status?: 'draft' };
  if (action === 'cancel') {
    patch = { scheduled_at: null, status: 'draft' };
  } else if (action === 'reschedule') {
    const checked = validateScheduledAt(body.scheduled_at, new Date());
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }
    patch = { scheduled_at: checked.scheduledAt };
  } else {
    return NextResponse.json(
      { error: "action must be 'cancel' or 'reschedule'" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('broadcasts')
    .update(patch)
    .eq('id', broadcast_id)
    .eq('user_id', user.id)
    .eq('status', 'scheduled')
    .select('id, status, scheduled_at')
    .maybeSingle();

  if (error) {
    console.error('[broadcast-schedule] update failed:', error.message);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: 'This broadcast is no longer scheduled (it may already be sending).' },
      { status: 409 }
    );
  }
  return NextResponse.json({ broadcast: data });
}
