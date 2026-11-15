-- ============================================================
-- 034_webhook_endpoints.sql
-- Outbound webhooks: a tenant registers HTTPS endpoints and ConverMesh POSTs
-- signed JSON events to them (message received/sent, contact created), so the
-- tenant's own systems, Zapier or Make can react.
--
--   crm_webhook_endpoints   one row per endpoint. The signing secret is stored
--                           ENCRYPTED (it must be readable to sign requests).
--   crm_webhook_deliveries  one row per delivery attempt, for the "recent
--                           deliveries" view. Old rows are pruned by the app.
--
-- Access: server routes only (service role). Platform admins may read/manage
-- directly; no tenant user can query these tables from the browser, so the
-- encrypted secret never leaves the server.
--
-- Idempotent: safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_webhook_endpoints (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  url                 TEXT NOT NULL CHECK (char_length(url) <= 2000),
  description         TEXT CHECK (description IS NULL OR char_length(description) <= 120),
  secret_enc          TEXT NOT NULL,
  events              TEXT[] NOT NULL DEFAULT ARRAY['message.received', 'message.sent', 'contact.created'],
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_success_at     TIMESTAMPTZ,
  last_failure_at     TIMESTAMPTZ,
  disabled_reason     TEXT,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_webhook_endpoints_tenant_id
  ON crm_webhook_endpoints (tenant_id)
  WHERE enabled;

CREATE OR REPLACE FUNCTION set_crm_webhook_endpoints_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_webhook_endpoints_updated_at ON crm_webhook_endpoints;
CREATE TRIGGER crm_webhook_endpoints_updated_at
  BEFORE UPDATE ON crm_webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION set_crm_webhook_endpoints_updated_at();

CREATE TABLE IF NOT EXISTS crm_webhook_deliveries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  endpoint_id   UUID NOT NULL REFERENCES crm_webhook_endpoints(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  http_status   INT,
  error         TEXT CHECK (error IS NULL OR char_length(error) <= 500),
  attempt       INT NOT NULL DEFAULT 1,
  duration_ms   INT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_webhook_deliveries_endpoint_created
  ON crm_webhook_deliveries (endpoint_id, created_at DESC);

ALTER TABLE crm_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins manage webhook endpoints" ON crm_webhook_endpoints;
DROP POLICY IF EXISTS "Platform admins manage webhook deliveries" ON crm_webhook_deliveries;

CREATE POLICY "Platform admins manage webhook endpoints" ON crm_webhook_endpoints
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE POLICY "Platform admins manage webhook deliveries" ON crm_webhook_deliveries
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
