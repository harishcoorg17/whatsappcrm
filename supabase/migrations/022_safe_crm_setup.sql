-- ============================================================
-- 022_safe_crm_setup.sql
-- Safe migration for environments where whatsappagent tables
-- already exist (contacts, conversations, messages, broadcasts, etc.)
-- Only creates NEW tables the CRM needs; skips existing ones.
-- ============================================================

-- ── Shared trigger function ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── profiles ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  role       TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile"   ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can view own profile"   ON profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS set_updated_at ON profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-create profile on signup
DROP TRIGGER   IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION  IF EXISTS public.handle_new_user();
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── pipelines ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipelines (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own pipelines" ON pipelines;
CREATE POLICY "Users can manage own pipelines" ON pipelines FOR ALL USING (auth.uid() = user_id);

-- ── pipeline_stages ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  color       TEXT NOT NULL DEFAULT '#3b82f6',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage pipeline stages" ON pipeline_stages;
CREATE POLICY "Users can manage pipeline stages" ON pipeline_stages FOR ALL
  USING (EXISTS (SELECT 1 FROM pipelines WHERE pipelines.id = pipeline_stages.pipeline_id AND pipelines.user_id = auth.uid()));

-- ── deals ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pipeline_id     UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id        UUID NOT NULL REFERENCES pipeline_stages(id),
  contact_id      UUID NOT NULL REFERENCES contacts(id),
  conversation_id UUID REFERENCES conversations(id),
  title           TEXT NOT NULL,
  value           NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency        TEXT DEFAULT 'USD',
  notes           TEXT,
  expected_close_date DATE,
  status          TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage    ON deals(stage_id);
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own deals" ON deals;
CREATE POLICY "Users can manage own deals" ON deals FOR ALL USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS set_updated_at ON deals;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── crm_tenants ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_tenants (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
  plan             TEXT NOT NULL DEFAULT 'starter',
  waba_id          TEXT,
  phone_number_id  TEXT,
  access_token_enc TEXT,
  verify_token     TEXT,
  webhook_url      TEXT,
  data_api_url     TEXT,
  data_api_config  JSONB,
  owner_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE crm_tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage tenants" ON crm_tenants;
CREATE POLICY "Admins manage tenants" ON crm_tenants FOR ALL USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION set_crm_tenants_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS crm_tenants_updated_at ON crm_tenants;
CREATE TRIGGER crm_tenants_updated_at
  BEFORE UPDATE ON crm_tenants
  FOR EACH ROW EXECUTE FUNCTION set_crm_tenants_updated_at();

-- ── embedded_signup_events ───────────────────────────────────
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

-- ── Add tenant_id to existing tables (safe — skips if missing) ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts','conversations','messages','tags',
    'broadcasts','broadcast_recipients',
    'automations','automation_steps','automation_logs','automation_pending_executions',
    'pipelines','pipeline_stages','deals',
    'flows','flow_nodes','flow_runs','flow_run_events',
    'message_templates','whatsapp_config',
    'custom_fields','contact_custom_values','contact_notes','audience_filters'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id UUID REFERENCES crm_tenants(id) ON DELETE CASCADE', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_tenant_id ON %I(tenant_id)', t, t);
      END IF;
    END IF;
  END LOOP;
END $$;
