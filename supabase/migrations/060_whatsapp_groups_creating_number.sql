-- ============================================================
-- 060: Which numbers may create WhatsApp groups, and which one made a group.
--
-- Group creation uses the tenant's primary number, plus any other number you
-- mark use_for_groups. Every other number (for example a tour leader's) is never
-- used to create groups. Mark the Amstago number like this:
--   UPDATE crm_tenant_numbers SET use_for_groups = TRUE
--   WHERE label ILIKE '%amstago%';   -- check the label first
--
-- wa_phone_number_id remembers the number Meta accepted, so the group's invite
-- link is later read with the same number.
-- Idempotent: safe to run more than once.
-- ============================================================

ALTER TABLE crm_tenant_numbers
  ADD COLUMN IF NOT EXISTS use_for_groups BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS wa_phone_number_id TEXT;
