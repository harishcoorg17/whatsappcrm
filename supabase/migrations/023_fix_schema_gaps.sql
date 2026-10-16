-- ============================================================
-- 023_fix_schema_gaps.sql
-- Adds columns and tables that exist in the CRM codebase but are
-- missing from a database that was originally set up by whatsappagent
-- (which has a simpler schema than the CRM migrations expect).
--
-- Safe to run multiple times — all changes use IF NOT EXISTS / DO $$.
-- ============================================================

-- ── 1. profiles.beta_features (migration 011) ────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS beta_features TEXT[]
    NOT NULL
    DEFAULT ARRAY[]::TEXT[];

-- ── 2. messages — add CRM columns missing from whatsappagent schema ──
-- whatsappagent's messages table uses:
--   role TEXT ('user'|'assistant')  →  maps to sender_type ('customer'|'agent')
--   content TEXT                    →  maps to content_text
-- The CRM code queries sender_type, content_text, content_type, status, etc.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_type   TEXT,
  ADD COLUMN IF NOT EXISTS content_text  TEXT,
  ADD COLUMN IF NOT EXISTS content_type  TEXT    NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS sender_id     UUID,
  ADD COLUMN IF NOT EXISTS media_url     TEXT,
  ADD COLUMN IF NOT EXISTS template_name TEXT,
  ADD COLUMN IF NOT EXISTS message_id    TEXT,
  ADD COLUMN IF NOT EXISTS status        TEXT    NOT NULL DEFAULT 'sent';

-- Backfill sender_type from existing role column
UPDATE messages
  SET sender_type = CASE
    WHEN role = 'user'      THEN 'customer'
    WHEN role = 'assistant' THEN 'agent'
    ELSE 'agent'
  END
  WHERE sender_type IS NULL;

-- Backfill content_text from existing content column
UPDATE messages
  SET content_text = content
  WHERE content_text IS NULL AND content IS NOT NULL;

-- Backfill message_id from whatsapp_msg_id if that column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'whatsapp_msg_id'
  ) THEN
    UPDATE messages
      SET message_id = whatsapp_msg_id
      WHERE message_id IS NULL AND whatsapp_msg_id IS NOT NULL;
  END IF;
END $$;

-- Make sender_type NOT NULL now that it is backfilled
ALTER TABLE messages
  ALTER COLUMN sender_type SET NOT NULL;

-- ── 3. broadcasts.total_recipients ───────────────────────────
-- whatsappagent uses total_count; CRM queries total_recipients
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS total_recipients INTEGER NOT NULL DEFAULT 0;

-- Backfill from total_count if that column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'broadcasts' AND column_name = 'total_count'
  ) THEN
    UPDATE broadcasts
      SET total_recipients = total_count
      WHERE total_recipients = 0 AND total_count > 0;
  END IF;
END $$;

-- ── 4. automations table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS automations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  enabled          BOOLEAN NOT NULL DEFAULT false,
  trigger_type     TEXT NOT NULL,
  trigger_config   JSONB NOT NULL DEFAULT '{}'::jsonb,
  execution_count  INTEGER NOT NULL DEFAULT 0,
  last_triggered   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automations_user ON automations(user_id);
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own automations" ON automations;
CREATE POLICY "Users can manage own automations" ON automations FOR ALL
  USING (auth.uid() = user_id);

-- ── 5. automation_steps ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_steps (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id  UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL DEFAULT 0,
  type           TEXT NOT NULL,
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  parent_step_id UUID REFERENCES automation_steps(id) ON DELETE CASCADE,
  branch         TEXT CHECK (branch IN ('yes', 'no')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_steps_automation ON automation_steps(automation_id, position);
ALTER TABLE automation_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own automation steps" ON automation_steps;
CREATE POLICY "Users can manage own automation steps" ON automation_steps FOR ALL
  USING (EXISTS (SELECT 1 FROM automations WHERE automations.id = automation_steps.automation_id AND automations.user_id = auth.uid()));

-- ── 6. automation_logs ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id   UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  trigger_event   TEXT NOT NULL,
  steps_executed  JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_automation
  ON automation_logs(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_user ON automation_logs(user_id);

ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own automation logs" ON automation_logs;
CREATE POLICY "Users can view own automation logs" ON automation_logs FOR ALL
  USING (auth.uid() = user_id);

-- ── 7. automation_pending_executions ─────────────────────────
CREATE TABLE IF NOT EXISTS automation_pending_executions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id  UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  log_id         UUID REFERENCES automation_logs(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES automation_steps(id) ON DELETE SET NULL,
  branch         TEXT CHECK (branch IN ('yes', 'no')),
  next_step_position INTEGER NOT NULL,
  context        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at         TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_pending_due
  ON automation_pending_executions(run_at) WHERE status = 'pending';

-- ── 8. increment_automation_execution_count RPC ──────────────
CREATE OR REPLACE FUNCTION increment_automation_execution_count(p_automation_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE automations
    SET execution_count = execution_count + 1,
        last_triggered = NOW()
    WHERE id = p_automation_id;
END;
$$;

-- ── 9. tenant_id on newly-created CRM tables ─────────────────
-- Re-run the safe add for tables created above (022 only ran for
-- tables that existed at that point).
DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='crm_tenants') THEN
    FOREACH t IN ARRAY ARRAY['automations','automation_steps','automation_logs','automation_pending_executions'] LOOP
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
          EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id UUID REFERENCES crm_tenants(id) ON DELETE CASCADE', t);
          EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_tenant_id ON %I(tenant_id)', t, t);
        END IF;
      END IF;
    END LOOP;
  END IF;
END $$;
