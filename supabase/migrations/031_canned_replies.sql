-- ============================================================
-- 031_canned_replies.sql
-- Quick replies for the inbox: type "/shortcut" in the composer to insert a
-- saved message. Depends on 030_team_members.sql (is_tenant_member,
-- member_owner_user_ids).
--
-- A reply belongs to its creator (user_id) and is either:
--   * tenant_id set  -> available when working that tenant, and visible to its
--                       team members (read-only for them);
--   * tenant_id NULL -> available in every tenant the creator works in.
-- Only an owner of the tenant (or a platform admin) can create tenant-wide
-- replies; anyone can keep personal ones.
--
-- Idempotent: safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS canned_replies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID REFERENCES crm_tenants(id) ON DELETE CASCADE,
  shortcut    TEXT NOT NULL CHECK (shortcut ~ '^[a-z0-9_-]{1,32}$'),
  title       TEXT CHECK (title IS NULL OR char_length(title) <= 80),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- One shortcut per creator and scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_canned_replies_scope_shortcut
  ON canned_replies (
    user_id,
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    shortcut
  );

CREATE INDEX IF NOT EXISTS idx_canned_replies_tenant_id
  ON canned_replies (tenant_id);

CREATE OR REPLACE FUNCTION set_canned_replies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS canned_replies_updated_at ON canned_replies;
CREATE TRIGGER canned_replies_updated_at
  BEFORE UPDATE ON canned_replies
  FOR EACH ROW EXECUTE FUNCTION set_canned_replies_updated_at();

ALTER TABLE canned_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own canned replies" ON canned_replies;
DROP POLICY IF EXISTS "Platform admins manage canned replies" ON canned_replies;
DROP POLICY IF EXISTS "Members read tenant canned replies" ON canned_replies;

-- Creators see and edit their own. A tenant-wide reply must be for a tenant the
-- creator owns, so an agent cannot publish to the whole team.
CREATE POLICY "Users manage own canned replies" ON canned_replies
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (
      tenant_id IS NULL
      OR tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
    )
  );

CREATE POLICY "Platform admins manage canned replies" ON canned_replies
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Team members read the replies shared with their tenant, plus the owner's
-- all-tenant replies.
CREATE POLICY "Members read tenant canned replies" ON canned_replies
  FOR SELECT USING (
    (tenant_id IS NOT NULL AND is_tenant_member(tenant_id))
    OR (tenant_id IS NULL AND user_id IN (SELECT member_owner_user_ids()))
  );
