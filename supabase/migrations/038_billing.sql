-- ============================================================
-- 038_billing.sql
-- Plans, trials and Razorpay subscriptions.
--
--   1. crm_tenants gets a 14-day trial clock, a subscription status, the
--      Razorpay ids and a count of paid extra agents. `plan` already exists
--      (starter | growth | scale; the older 'enterprise' is treated as scale).
--      While a tenant is trialing it gets Growth limits whatever `plan` says.
--   2. crm_invoices: one row per successful charge, for the billing history.
--   3. crm_billing_events: every Razorpay webhook event id, so a retried
--      delivery is processed once.
--
-- Existing tenants start a 14-day trial on the day this runs.
-- Both new tables are written only by server routes (service role); tenant
-- owners can read their own invoices.
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- ── 1. Tenant billing columns ───────────────────────────────────────────────

ALTER TABLE crm_tenants
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS extra_agents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_tenants_subscription_status_check'
  ) THEN
    ALTER TABLE crm_tenants ADD CONSTRAINT crm_tenants_subscription_status_check
      CHECK (subscription_status IN
        ('trialing', 'active', 'past_due', 'canceled', 'expired'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_tenants_billing_interval_check'
  ) THEN
    ALTER TABLE crm_tenants ADD CONSTRAINT crm_tenants_billing_interval_check
      CHECK (billing_interval IN ('monthly', 'yearly'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_tenants_extra_agents_check'
  ) THEN
    ALTER TABLE crm_tenants ADD CONSTRAINT crm_tenants_extra_agents_check
      CHECK (extra_agents >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tenants_razorpay_subscription
  ON crm_tenants (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

-- ── 2. Invoices / payments ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_invoices (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  razorpay_payment_id   TEXT NOT NULL UNIQUE,
  razorpay_invoice_id   TEXT,
  razorpay_subscription_id TEXT,
  plan                  TEXT,
  billing_interval      TEXT,
  -- Amounts in paise. amount_paise is what the customer paid (GST included).
  amount_paise          BIGINT NOT NULL CHECK (amount_paise >= 0),
  tax_paise             BIGINT NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  currency              TEXT NOT NULL DEFAULT 'INR',
  status                TEXT NOT NULL DEFAULT 'paid'
                        CHECK (status IN ('paid', 'failed', 'refunded')),
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_invoices_tenant
  ON crm_invoices (tenant_id, created_at DESC);

ALTER TABLE crm_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins manage invoices" ON crm_invoices;
DROP POLICY IF EXISTS "Owners view their invoices" ON crm_invoices;

CREATE POLICY "Platform admins manage invoices" ON crm_invoices
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE POLICY "Owners view their invoices" ON crm_invoices
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
  );

-- ── 3. Webhook idempotency ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_billing_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  payload      JSONB,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service role only: no policies, so no other role can read or write it.
ALTER TABLE crm_billing_events ENABLE ROW LEVEL SECURITY;
