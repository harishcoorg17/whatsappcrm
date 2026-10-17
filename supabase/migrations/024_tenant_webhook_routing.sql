-- ============================================================
-- 024_tenant_webhook_routing.sql
-- Wires multi-tenant webhook routing:
--   1. Fast lookup index on crm_tenants.phone_number_id
--   2. tenant_id column on contacts + conversations + messages
--   3. Relaxes whatsapp_config UNIQUE(user_id) so one admin user can
--      have configs for multiple tenants
-- ============================================================

-- ── 1. Fast webhook lookup: phone_number_id on crm_tenants ──────────────────
CREATE INDEX IF NOT EXISTS idx_crm_tenants_phone_number_id
  ON crm_tenants(phone_number_id)
  WHERE phone_number_id IS NOT NULL;

-- ── 2. tenant_id on contacts ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE contacts ADD COLUMN tenant_id UUID REFERENCES crm_tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_contacts_tenant_id ON contacts(tenant_id);
  END IF;
END $$;

-- ── 3. tenant_id on conversations ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE conversations ADD COLUMN tenant_id UUID REFERENCES crm_tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_conversations_tenant_id ON conversations(tenant_id);
  END IF;
END $$;

-- ── 4. tenant_id on messages ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN tenant_id UUID REFERENCES crm_tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_tenant_id ON messages(tenant_id);
  END IF;
END $$;

-- ── 5. Relax whatsapp_config UNIQUE(user_id) ────────────────────────────────
-- Original schema: one config per user. Multi-tenant: one admin manages many
-- tenants. phone_number_id already has UNIQUE from migration 013.
ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_user_id_key;

-- ── 6. tenant_id on whatsapp_config ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_config' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE whatsapp_config ADD COLUMN tenant_id UUID REFERENCES crm_tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_whatsapp_config_tenant_id ON whatsapp_config(tenant_id);
  END IF;
END $$;
