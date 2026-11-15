-- Marks messages written by the AI agent, so the inbox can tell them apart
-- from bot-flow messages (both have sender_type = 'bot'). Existing rows stay
-- false, and nothing reads this column for anything but the "AI" label.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sent_by_ai boolean NOT NULL DEFAULT false;
