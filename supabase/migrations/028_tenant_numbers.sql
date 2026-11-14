-- ============================================================
-- 028_tenant_numbers.sql
-- Several WhatsApp numbers per tenant (e.g. 3 for one tenant, 5 for another).
--
--   1. crm_tenant_numbers: one row per connected number.
--      crm_tenants.phone_number_id / waba_id / access_token_enc stay as the
--      tenant's PRIMARY number, so code that has not been updated keeps
--      working and always sees the primary.
--   2. conversations.phone_number_id: the number a conversation is on, so a
--      reply leaves from the number the customer wrote to (WhatsApp's 24-hour
--      window is per number pair).
--   3. Backfill: every existing tenant number becomes that tenant's primary
--      row, and existing conversations are tagged with their tenant's number.
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- ── 1. Numbers table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_tenant_numbers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  phone_number_id       TEXT NOT NULL,
  waba_id               TEXT,
  access_token_enc      TEXT,
  label                 TEXT,
  display_phone_number  TEXT,
  is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- The webhook routes by phone_number_id, so a number may belong to one tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_tenant_numbers_phone_number_id
  ON crm_tenant_numbers (phone_number_id);

-- At most one primary number per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_tenant_numbers_one_primary
  ON crm_tenant_numbers (tenant_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_crm_tenant_numbers_tenant_id
  ON crm_tenant_numbers (tenant_id);

CREATE OR REPLACE FUNCTION set_crm_tenant_numbers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_tenant_numbers_updated_at ON crm_tenant_numbers;
CREATE TRIGGER crm_tenant_numbers_updated_at
  BEFORE UPDATE ON crm_tenant_numbers
  FOR EACH ROW EXECUTE FUNCTION set_crm_tenant_numbers_updated_at();

-- ── 2. Row level security (same rules as crm_tenants) ───────────────────────
-- Platform admins manage every number; an owner can only read their own
-- tenant's rows. All other writes go through server routes (service role).

ALTER TABLE crm_tenant_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins manage tenant numbers" ON crm_tenant_numbers;
DROP POLICY IF EXISTS "Owners view own tenant numbers" ON crm_tenant_numbers;

CREATE POLICY "Platform admins manage tenant numbers" ON crm_tenant_numbers
  FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Owners view own tenant numbers" ON crm_tenant_numbers
  FOR SELECT
  USING (
    tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
  );

-- ── 3. Backfill: each tenant's current number becomes its primary ───────────

INSERT INTO crm_tenant_numbers
  (tenant_id, phone_number_id, waba_id, access_token_enc, label, is_primary, status)
SELECT t.id, t.phone_number_id, t.waba_id, t.access_token_enc, 'Primary', TRUE, 'active'
FROM crm_tenants t
WHERE t.phone_number_id IS NOT NULL
ON CONFLICT (phone_number_id) DO NOTHING;

-- ── 3b. Keep the primary row in step with crm_tenants ───────────────────────
-- Existing screens (Edit credentials, Connect WA / embedded signup) still write
-- the tenant's single number onto crm_tenants. This trigger mirrors that into
-- crm_tenant_numbers so the numbers table never holds a stale primary.

CREATE OR REPLACE FUNCTION sync_primary_tenant_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone_number_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Demote first: the partial unique index allows one primary per tenant.
  UPDATE crm_tenant_numbers
  SET is_primary = FALSE
  WHERE tenant_id = NEW.id AND is_primary AND phone_number_id <> NEW.phone_number_id;

  UPDATE crm_tenant_numbers
  SET waba_id = NEW.waba_id,
      access_token_enc = NEW.access_token_enc,
      is_primary = TRUE,
      status = 'active'
  WHERE tenant_id = NEW.id AND phone_number_id = NEW.phone_number_id;

  IF NOT FOUND THEN
    INSERT INTO crm_tenant_numbers
      (tenant_id, phone_number_id, waba_id, access_token_enc, label, is_primary, status)
    VALUES
      (NEW.id, NEW.phone_number_id, NEW.waba_id, NEW.access_token_enc, 'Primary', TRUE, 'active')
    ON CONFLICT (phone_number_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_tenants_sync_primary_number ON crm_tenants;
CREATE TRIGGER crm_tenants_sync_primary_number
  AFTER INSERT OR UPDATE OF phone_number_id, waba_id, access_token_enc ON crm_tenants
  FOR EACH ROW EXECUTE FUNCTION sync_primary_tenant_number();

-- ── 4. Conversations remember which number they are on ──────────────────────

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS phone_number_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_phone_number_id
  ON conversations (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

-- Existing conversations were all on their tenant's single number.
UPDATE conversations c
SET phone_number_id = t.phone_number_id
FROM crm_tenants t
WHERE c.tenant_id = t.id
  AND c.phone_number_id IS NULL
  AND t.phone_number_id IS NOT NULL;
