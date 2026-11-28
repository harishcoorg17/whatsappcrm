-- ============================================================
-- 061: WhatsApp group chats in the inbox.
--
-- A group created through the Cloud API Groups API sends its messages to the
-- same webhook as 1:1 chats, each tagged with a group_id. Each group gets one
-- conversation (conversations.wa_group_id) filed under a placeholder contact
-- whose phone starts with "group:" (so it is never messaged or broadcast to).
-- Each message records which participant wrote it.
-- Idempotent: safe to run more than once.
-- ============================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS wa_group_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_tenant_wa_group
  ON conversations (tenant_id, wa_group_id)
  WHERE wa_group_id IS NOT NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_wa_id TEXT;
