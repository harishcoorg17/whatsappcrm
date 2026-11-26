-- ============================================================
-- 059: Groups the CRM creates itself through the WhatsApp Cloud API Groups API.
--
-- creation_status:
--   manual   the group is made by hand and its invite link pasted in (default, as before)
--   creating a create request was sent to Meta; the invite link arrives by webhook
--   active   the group exists on WhatsApp
--   failed   Meta rejected the request (see creation_error); it can be retried
-- wa_request_id / wa_group_id tie the Meta webhook back to the row.
-- Idempotent: safe to run more than once.
-- ============================================================

ALTER TABLE whatsapp_groups
  ADD COLUMN IF NOT EXISTS creation_status TEXT NOT NULL DEFAULT 'manual'
    CHECK (creation_status IN ('manual', 'creating', 'active', 'failed'));

ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS creation_error TEXT
  CHECK (creation_error IS NULL OR char_length(creation_error) <= 500);

ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS wa_request_id TEXT;
ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS wa_group_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_groups_wa_group_id
  ON whatsapp_groups (wa_group_id) WHERE wa_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_wa_request_id
  ON whatsapp_groups (wa_request_id) WHERE wa_request_id IS NOT NULL;
