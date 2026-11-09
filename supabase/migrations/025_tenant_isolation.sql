-- ============================================================
-- 025_tenant_isolation.sql
-- Closes cross-tenant exposure on crm_tenants.
--
-- Before: the policy was `FOR ALL USING (auth.uid() IS NOT NULL)`, so any
-- logged-in user (including a client who signed up) could read, edit or delete
-- every tenant, including its encrypted WhatsApp token and verify token.
--
-- After:
--   * platform admins (crm_platform_admins) manage every tenant;
--   * a tenant's owner can only read their own row;
--   * all other writes go through server routes using the service role.
-- ============================================================

-- ── 1. Platform admins ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- No policies on purpose: only the service role (which bypasses RLS) may read
-- or change this table, so a user can never promote themselves.
ALTER TABLE crm_platform_admins ENABLE ROW LEVEL SECURITY;

-- Keep today's behaviour for people who already have an account: every existing
-- profile becomes a platform admin. Prune afterwards with
--   DELETE FROM crm_platform_admins WHERE user_id = '<uuid>';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    INSERT INTO crm_platform_admins (user_id)
    SELECT user_id FROM profiles WHERE user_id IS NOT NULL
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM crm_platform_admins WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated;

-- ── 2. crm_tenants policies ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins manage tenants" ON crm_tenants;
DROP POLICY IF EXISTS "Platform admins manage tenants" ON crm_tenants;
DROP POLICY IF EXISTS "Owners view own tenant" ON crm_tenants;

CREATE POLICY "Platform admins manage tenants" ON crm_tenants
  FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Owners view own tenant" ON crm_tenants
  FOR SELECT
  USING (owner_user_id = auth.uid());

-- ── 3. Embedded Signup audit log ────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins view signup events" ON embedded_signup_events;
DROP POLICY IF EXISTS "Admins and owners view signup events" ON embedded_signup_events;

CREATE POLICY "Admins and owners view signup events" ON embedded_signup_events
  FOR SELECT
  USING (
    is_platform_admin()
    OR tenant_id IN (
      SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid()
    )
  );

-- ── 4. One phone number, one tenant ─────────────────────────────────────────
-- The webhook routes by phone_number_id. Two tenants sharing one id would make
-- routing ambiguous (and let one tenant intercept another's messages).
-- This fails loudly if duplicates already exist; fix them, then re-run.

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_tenants_phone_number_id
  ON crm_tenants (phone_number_id)
  WHERE phone_number_id IS NOT NULL;
