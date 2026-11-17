-- 050_broadcast_scheduling.sql
-- Scheduled broadcasts: a lease so overlapping cron runs never double-send,
-- plus an atomic claim function. Safe to re-run.

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ;

-- Cron looks for due broadcasts every minute.
CREATE INDEX IF NOT EXISTS idx_broadcasts_scheduled_due
  ON broadcasts (scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status IN ('scheduled', 'sending');

-- The cron sends the oldest pending recipients of a broadcast each batch.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending
  ON broadcast_recipients (broadcast_id, created_at)
  WHERE status = 'pending';

-- Atomically claims broadcasts for ONE cron run.
--   * 'scheduled' and due                      -> flipped to 'sending'
--   * 'sending' with an EXPIRED lease and a
--     scheduled_at (a cron run that timed out
--     or crashed mid-way, or released its lease
--     because the audience is not finished)    -> resumed
-- Broadcasts started interactively have scheduled_at NULL and are never
-- picked up. FOR UPDATE SKIP LOCKED + the lease make two concurrent runs
-- claim disjoint rows.
CREATE OR REPLACE FUNCTION claim_due_broadcasts(
  p_limit INTEGER DEFAULT 3,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF broadcasts
LANGUAGE sql
AS $$
  UPDATE broadcasts b
  SET status = 'sending',
      claimed_until = NOW() + make_interval(secs => p_lease_seconds),
      started_at = COALESCE(b.started_at, NOW())
  WHERE b.id IN (
    SELECT id FROM broadcasts
    WHERE scheduled_at IS NOT NULL
      AND (
        (status = 'scheduled' AND scheduled_at <= NOW())
        OR (status = 'sending' AND claimed_until IS NOT NULL AND claimed_until <= NOW())
      )
    ORDER BY scheduled_at ASC
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING b.*;
$$;

-- Only the service role (the cron route) may claim.
REVOKE ALL ON FUNCTION claim_due_broadcasts(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_due_broadcasts(INTEGER, INTEGER) TO service_role;
