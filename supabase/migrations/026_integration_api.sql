-- ============================================================
-- 026: server-to-server integration API
--
-- Lets another system (the Amstago backend) ask the CRM to send an approved
-- WhatsApp template, using one API key per tenant.
--
--   crm_api_keys          one row per key. Only a SHA-256 hash is stored, so a
--                         leaked database does not leak usable keys; the
--                         plaintext is shown once, when the key is created.
--   crm_integration_sends one row per send request, keyed by the caller's own
--                         `reference` (for example "booking-123:confirmation").
--                         A repeat of the same reference is answered from this
--                         row instead of messaging the customer twice.
--
-- Both tables are reached only by the server with the service role, through
-- routes that check who is asking. RLS is enabled with no policies, so the
-- browser and signed-in users cannot read or write them directly.
--
-- Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT 'Backend',
  -- First characters of the key, shown in the UI so a key can be recognised.
  key_prefix   TEXT NOT NULL,
  -- SHA-256 (hex) of the full key. Never the key itself.
  key_hash     TEXT NOT NULL UNIQUE,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_api_keys_tenant_active
  ON crm_api_keys (tenant_id)
  WHERE revoked_at IS NULL;

ALTER TABLE crm_api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS crm_integration_sends (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  -- The caller's own id for this message; unique per tenant.
  reference           TEXT NOT NULL,
  template_name       TEXT NOT NULL,
  to_phone            TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  whatsapp_message_id TEXT,
  conversation_id     UUID,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_crm_integration_sends_message_id
  ON crm_integration_sends (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

ALTER TABLE crm_integration_sends ENABLE ROW LEVEL SECURITY;
