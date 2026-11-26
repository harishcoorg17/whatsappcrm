-- ============================================================
-- 058: WhatsApp groups that are waiting for their invite link.
--
-- The Amstago backend registers every leader-created group trip here as soon
-- as it exists. The WhatsApp group itself is made by hand afterwards, so the
-- row starts without an invite link. The CHECK on invite_url still applies to
-- any link that is set (a NULL passes it).
-- external_ref is the caller's id for the group; it makes retries safe.
-- Idempotent: safe to run more than once.
-- ============================================================

ALTER TABLE whatsapp_groups ALTER COLUMN invite_url DROP NOT NULL;

ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS external_ref TEXT
  CHECK (external_ref IS NULL OR char_length(external_ref) <= 128);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_groups_external_ref
  ON whatsapp_groups (tenant_id, external_ref)
  WHERE external_ref IS NOT NULL;
