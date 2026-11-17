import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClaimedBroadcast {
  id: string;
  user_id: string;
  name: string;
  template_name: string;
  template_language: string | null;
  template_variables: Record<string, unknown> | null;
}

export const DEFAULT_CLAIM_LIMIT = 3;
/** Longer than a run's time budget so a live run never loses its lease. */
export const DEFAULT_LEASE_SECONDS = 120;

/**
 * Atomically claims due scheduled broadcasts via the `claim_due_broadcasts`
 * SQL function (migration 050). It uses FOR UPDATE SKIP LOCKED plus a lease,
 * so two overlapping cron runs can never both receive the same broadcast.
 *
 * Throws on a database error so the cron responds 500 and retries next minute.
 */
export async function claimDueBroadcasts(
  db: SupabaseClient,
  opts: { limit?: number; leaseSeconds?: number } = {}
): Promise<ClaimedBroadcast[]> {
  const { data, error } = await db.rpc('claim_due_broadcasts', {
    p_limit: opts.limit ?? DEFAULT_CLAIM_LIMIT,
    p_lease_seconds: opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
  });
  if (error) throw new Error(`claim_due_broadcasts failed: ${error.message}`);
  return (data ?? []) as ClaimedBroadcast[];
}

/** Lets the next run resume a broadcast immediately (lease expires now). */
export async function releaseBroadcastClaim(
  db: SupabaseClient,
  broadcastId: string
): Promise<void> {
  const { error } = await db
    .from('broadcasts')
    .update({ claimed_until: new Date().toISOString() })
    .eq('id', broadcastId)
    .eq('status', 'sending');
  if (error) {
    console.error('[broadcast-cron] release failed:', error.message);
  }
}
