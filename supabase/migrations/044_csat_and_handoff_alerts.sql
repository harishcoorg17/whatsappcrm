-- ============================================================
-- 044_csat_and_handoff_alerts.sql
-- (A) CSAT: an optional 1-5 rating survey sent when an agent closes a chat,
--     and the ratings customers send back.
-- (B) Agent alerts: an optional email and/or WhatsApp message when a chat is
--     handed from the bot to a human.
--
-- Everything defaults to OFF. Idempotent: safe to run more than once.
--
--   crm_tenants.csat_enabled / csat_message     survey toggle and wording
--   crm_tenants.handoff_alert_email             email the assigned agent (or the
--                                               tenant's admins when unassigned)
--   crm_tenants.handoff_alert_whatsapp(+_number) WhatsApp a configured number
--   conversations.csat_requested_at             when the survey went out
--   conversations.handoff_alerted_at            when agents were last alerted
--                                               (rate limit: once per handoff)
--   csat_responses                              one rating per survey sent
-- ============================================================

ALTER TABLE crm_tenants
  ADD COLUMN IF NOT EXISTS csat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS csat_message TEXT,
  ADD COLUMN IF NOT EXISTS handoff_alert_email BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS handoff_alert_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS handoff_alert_number TEXT;

ALTER TABLE crm_tenants DROP CONSTRAINT IF EXISTS crm_tenants_csat_message_length;
ALTER TABLE crm_tenants
  ADD CONSTRAINT crm_tenants_csat_message_length
  CHECK (csat_message IS NULL OR char_length(csat_message) <= 600);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS csat_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_alerted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS csat_responses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  agent_id      UUID,
  score         INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  requested_at  TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One rating per survey sent: a double tap cannot count twice.
  UNIQUE (conversation_id, requested_at)
);

CREATE INDEX IF NOT EXISTS idx_csat_responses_tenant_created
  ON csat_responses (tenant_id, created_at DESC);

ALTER TABLE csat_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant people read csat responses" ON csat_responses;
CREATE POLICY "Tenant people read csat responses" ON csat_responses
  FOR SELECT USING (
    is_platform_admin()
    OR is_tenant_member(tenant_id)
    OR tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
  );
-- Writes happen only in the webhook (service role).

-- Average rating and count for the Analytics page. SECURITY INVOKER, so row
-- level security decides what the caller can aggregate.
CREATE OR REPLACE FUNCTION csat_summary(p_tenant_id UUID, p_days INT DEFAULT 7)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'responses', COUNT(*),
    'average',   ROUND(AVG(score)::numeric, 2),
    'distribution', jsonb_build_object(
      '1', COUNT(*) FILTER (WHERE score = 1),
      '2', COUNT(*) FILTER (WHERE score = 2),
      '3', COUNT(*) FILTER (WHERE score = 3),
      '4', COUNT(*) FILTER (WHERE score = 4),
      '5', COUNT(*) FILTER (WHERE score = 5)
    )
  )
  FROM csat_responses
  WHERE tenant_id = p_tenant_id
    AND created_at >= NOW() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 7), 90)));
$$;
