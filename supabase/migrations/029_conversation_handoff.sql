-- Bot -> human handoff state on conversations.
-- A conversation with status = 'pending' is "handed off": flows and
-- auto-reply automations stay silent until an agent returns it to the bot
-- (status -> 'open') or closes it.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_handoff
  ON conversations (user_id, handoff_at DESC)
  WHERE handoff_at IS NOT NULL;
