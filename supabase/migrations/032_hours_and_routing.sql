-- ============================================================
-- 032_hours_and_routing.sql
-- Business hours with an away message, and automatic assignment of new
-- conversations to team members.
--
-- Everything defaults to OFF: no tenant changes behaviour until it turns
-- these on in Tenants > Hours & routing.
--
--   crm_tenants.business_hours  JSON: { enabled, timezone, days: { mon: {open, close} | null, ... } }
--   crm_tenants.away_message    text sent (once per 12 hours per chat) outside hours
--   crm_tenants.auto_assign     assign unassigned new chats to the least-busy team member
--   conversations.away_sent_at  when the away message last went out on this chat
--
-- Idempotent: safe to run more than once.
-- ============================================================

ALTER TABLE crm_tenants
  ADD COLUMN IF NOT EXISTS business_hours JSONB,
  ADD COLUMN IF NOT EXISTS away_message TEXT,
  ADD COLUMN IF NOT EXISTS auto_assign BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE crm_tenants DROP CONSTRAINT IF EXISTS crm_tenants_away_message_length;
ALTER TABLE crm_tenants
  ADD CONSTRAINT crm_tenants_away_message_length
  CHECK (away_message IS NULL OR char_length(away_message) <= 1000);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS away_sent_at TIMESTAMPTZ;
