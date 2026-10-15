-- ============================================================
-- 021_multitenancy.sql
-- Adds multi-tenant support: crm_tenants table + tenant_id FK on all core tables.
-- Safe to run multiple times (uses IF NOT EXISTS / dynamic DO block).
-- ============================================================

-- ── 1. Tenants master table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_tenants (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
  plan               TEXT NOT NULL DEFAULT 'starter',
  waba_id            TEXT,
  phone_number_id    TEXT,
  access_token_enc   TEXT,
  verify_token       TEXT,
  webhook_url        TEXT,
  data_api_url       TEXT,
  data_api_config    JSONB,
  owner_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE crm_tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage tenants" ON crm_tenants;
CREATE POLICY "Admins manage tenants" ON crm_tenants
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ── 2. Add tenant_id to all core tables ──────────────────────────────────────

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'conversations', 'messages', 'tags',
    'broadcasts', 'broadcast_recipients',
    'automations', 'automation_steps', 'automation_logs', 'automation_pending_executions',
    'pipelines', 'pipeline_stages', 'deals',
    'flows', 'flow_nodes', 'flow_runs', 'flow_run_events',
    'message_templates', 'whatsapp_config',
    'custom_fields', 'contact_custom_values', 'contact_notes',
    'audience_filters'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
      ) THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id UUID REFERENCES crm_tenants(id) ON DELETE CASCADE', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_tenant_id ON %I(tenant_id)', t, t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ── 3. Updated-at trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_crm_tenants_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS crm_tenants_updated_at ON crm_tenants;
CREATE TRIGGER crm_tenants_updated_at
  BEFORE UPDATE ON crm_tenants
  FOR EACH ROW EXECUTE FUNCTION set_crm_tenants_updated_at();

-- ── 5. Embedded Signup audit log ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS embedded_signup_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID REFERENCES crm_tenants(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  waba_id         TEXT,
  phone_number_id TEXT,
  raw_payload     JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE embedded_signup_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view signup events" ON embedded_signup_events;
CREATE POLICY "Admins view signup events" ON embedded_signup_events
  FOR SELECT USING (auth.uid() IS NOT NULL);
