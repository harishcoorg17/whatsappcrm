-- ============================================================
-- 040_store_integrations.sql
-- Shopify / WooCommerce store connections. A store POSTs signed webhooks to the
-- CRM; each event fires an automation trigger (order_placed, order_fulfilled,
-- cart_abandoned) so tenants can send WhatsApp templates/messages.
--
--   crm_store_connections  one row per connected store. `public_id` is the
--                          unguessable token in the webhook URL; the signing
--                          secret is stored ENCRYPTED (AES-GCM, same helper as
--                          WhatsApp tokens).
--   crm_store_events       one row per received event. UNIQUE (connection_id,
--                          dedupe_key) makes webhook retries idempotent.
--                          Abandoned carts wait here (status 'pending') until
--                          `fire_at`, and are cancelled if the order arrives.
--
-- Access: server routes only (service role). Platform admins may manage rows
-- directly; no tenant user can query these tables from the browser.
--
-- Idempotent: safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_store_connections (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  platform                 TEXT NOT NULL CHECK (platform IN ('shopify', 'woocommerce')),
  shop_domain              TEXT NOT NULL CHECK (char_length(shop_domain) BETWEEN 3 AND 255),
  public_id                TEXT NOT NULL UNIQUE,
  secret_enc               TEXT NOT NULL,
  default_country_code     TEXT NOT NULL DEFAULT '91' CHECK (default_country_code ~ '^[0-9]{1,4}$'),
  abandoned_after_minutes  INT NOT NULL DEFAULT 60 CHECK (abandoned_after_minutes BETWEEN 5 AND 10080),
  enabled                  BOOLEAN NOT NULL DEFAULT TRUE,
  last_event_at            TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, platform, shop_domain)
);

CREATE INDEX IF NOT EXISTS idx_crm_store_connections_tenant
  ON crm_store_connections (tenant_id);

CREATE OR REPLACE FUNCTION set_crm_store_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_store_connections_updated_at ON crm_store_connections;
CREATE TRIGGER crm_store_connections_updated_at
  BEFORE UPDATE ON crm_store_connections
  FOR EACH ROW EXECUTE FUNCTION set_crm_store_connections_updated_at();

CREATE TABLE IF NOT EXISTS crm_store_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id  UUID NOT NULL REFERENCES crm_store_connections(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  dedupe_key     TEXT NOT NULL,
  topic          TEXT NOT NULL,
  trigger_type   TEXT NOT NULL,
  -- Shopify checkout token / order link, used to cancel an abandoned cart.
  checkout_token TEXT,
  status         TEXT NOT NULL DEFAULT 'processed'
                   CHECK (status IN ('pending', 'processing', 'processed', 'cancelled', 'failed')),
  fire_at        TIMESTAMPTZ,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  error          TEXT CHECK (error IS NULL OR char_length(error) <= 500),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connection_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_store_events_connection_created
  ON crm_store_events (connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_store_events_due
  ON crm_store_events (fire_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_crm_store_events_checkout
  ON crm_store_events (connection_id, checkout_token) WHERE checkout_token IS NOT NULL;

ALTER TABLE crm_store_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_store_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins manage store connections" ON crm_store_connections;
DROP POLICY IF EXISTS "Platform admins manage store events" ON crm_store_events;

CREATE POLICY "Platform admins manage store connections" ON crm_store_connections
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE POLICY "Platform admins manage store events" ON crm_store_events
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
