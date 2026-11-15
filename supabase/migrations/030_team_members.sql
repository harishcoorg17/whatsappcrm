-- ============================================================
-- 030_team_members.sql
-- Teams: several people can work one tenant's inbox.
--
-- Until now every row was owned by one user (user_id = the tenant owner) and
-- row level security only let that user in. This adds:
--   1. crm_tenant_members: who belongs to a tenant, as 'admin' or 'agent'.
--      The tenant owner (crm_tenants.owner_user_id) stays the implicit owner.
--   2. ADDITIVE policies so members can work the tenant's conversations,
--      messages, contacts, notes and tags. Existing "own rows" policies are
--      untouched, so owners and platform admins lose nothing.
--   3. SECURITY DEFINER helpers/RPCs so members can see their tenants, their
--      teammates' names and the tenant's number labels WITHOUT being able to
--      read crm_tenants or crm_tenant_numbers directly (those rows hold
--      encrypted WhatsApp tokens).
--
-- Roles: 'admin' manages the team; 'agent' works conversations. Settings,
-- templates, broadcasts, flows and automations stay owner-only for now.
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- ── 1. Members table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_tenant_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  invited_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_tenant_members_user_id
  ON crm_tenant_members (user_id);

ALTER TABLE crm_tenant_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins manage tenant members" ON crm_tenant_members;
DROP POLICY IF EXISTS "Members view own membership" ON crm_tenant_members;
DROP POLICY IF EXISTS "Owners view their tenant members" ON crm_tenant_members;

CREATE POLICY "Platform admins manage tenant members" ON crm_tenant_members
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE POLICY "Members view own membership" ON crm_tenant_members
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Owners view their tenant members" ON crm_tenant_members
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
  );

-- All writes go through server routes (service role), which check who may
-- manage the team.

-- ── 2. Helpers (SECURITY DEFINER so policies never recurse) ─────────────────

CREATE OR REPLACE FUNCTION is_tenant_member(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM crm_tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION member_owner_user_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.owner_user_id
  FROM crm_tenants t
  JOIN crm_tenant_members m ON m.tenant_id = t.id
  WHERE m.user_id = auth.uid() AND t.owner_user_id IS NOT NULL;
$$;

-- Everyone who shares a tenant with the caller (owner, admins, agents).
CREATE OR REPLACE FUNCTION teammate_user_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.user_id
    FROM crm_tenant_members m
    JOIN crm_tenants t ON t.id = m.tenant_id
   WHERE t.owner_user_id = auth.uid()
  UNION
  SELECT t.owner_user_id
    FROM crm_tenants t
    JOIN crm_tenant_members m ON m.tenant_id = t.id
   WHERE m.user_id = auth.uid() AND t.owner_user_id IS NOT NULL
  UNION
  SELECT m2.user_id
    FROM crm_tenant_members m1
    JOIN crm_tenant_members m2 ON m2.tenant_id = m1.tenant_id
   WHERE m1.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION is_tenant_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION member_owner_user_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION teammate_user_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_tenant_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION member_owner_user_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION teammate_user_ids() TO authenticated;

-- ── 3. Token-free views of the data members need ────────────────────────────

-- Tenants the caller belongs to as a member (for the tenant switcher).
CREATE OR REPLACE FUNCTION list_member_tenants()
RETURNS TABLE (id UUID, slug TEXT, name TEXT, status TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.slug, t.name, t.status
  FROM crm_tenants t
  JOIN crm_tenant_members m ON m.tenant_id = t.id
  WHERE m.user_id = auth.uid();
$$;

-- Number labels (never tokens) for tenants the caller owns, belongs to, or
-- administers as a platform admin. Drives the inbox number badge and filter.
CREATE OR REPLACE FUNCTION list_visible_tenant_numbers()
RETURNS TABLE (
  tenant_id UUID,
  phone_number_id TEXT,
  label TEXT,
  display_phone_number TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT n.tenant_id, n.phone_number_id, n.label, n.display_phone_number
  FROM crm_tenant_numbers n
  WHERE n.status = 'active'
    AND (
      is_platform_admin()
      OR n.tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
      OR n.tenant_id IN (SELECT tenant_id FROM crm_tenant_members WHERE user_id = auth.uid())
    )
  ORDER BY n.created_at;
$$;

REVOKE ALL ON FUNCTION list_member_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION list_visible_tenant_numbers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_member_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION list_visible_tenant_numbers() TO authenticated;

-- ── 4. Additive policies: members work the tenant's conversations ───────────

DROP POLICY IF EXISTS "Members manage tenant conversations" ON conversations;
CREATE POLICY "Members manage tenant conversations" ON conversations
  FOR ALL
  USING (tenant_id IS NOT NULL AND is_tenant_member(tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Members manage tenant contacts" ON contacts;
CREATE POLICY "Members manage tenant contacts" ON contacts
  FOR ALL
  USING (tenant_id IS NOT NULL AND is_tenant_member(tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Members manage tenant messages" ON messages;
CREATE POLICY "Members manage tenant messages" ON messages
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND c.tenant_id IS NOT NULL
      AND is_tenant_member(c.tenant_id)
  ));

DROP POLICY IF EXISTS "Members see tenant reactions" ON message_reactions;
CREATE POLICY "Members see tenant reactions" ON message_reactions
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND c.tenant_id IS NOT NULL
      AND is_tenant_member(c.tenant_id)
  ));

DROP POLICY IF EXISTS "Members add tenant reactions" ON message_reactions;
CREATE POLICY "Members add tenant reactions" ON message_reactions
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND c.tenant_id IS NOT NULL
      AND is_tenant_member(c.tenant_id)
  ));

-- Notes keep their author: a member can only write notes as themselves.
DROP POLICY IF EXISTS "Members manage tenant notes" ON contact_notes;
CREATE POLICY "Members manage tenant notes" ON contact_notes
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM contacts ct
    WHERE ct.id = contact_notes.contact_id
      AND ct.tenant_id IS NOT NULL
      AND is_tenant_member(ct.tenant_id)
  ))
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM contacts ct
      WHERE ct.id = contact_notes.contact_id
        AND ct.tenant_id IS NOT NULL
        AND is_tenant_member(ct.tenant_id)
    )
  );

DROP POLICY IF EXISTS "Members manage tenant contact tags" ON contact_tags;
CREATE POLICY "Members manage tenant contact tags" ON contact_tags
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM contacts ct
    WHERE ct.id = contact_tags.contact_id
      AND ct.tenant_id IS NOT NULL
      AND is_tenant_member(ct.tenant_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM contacts ct
    WHERE ct.id = contact_tags.contact_id
      AND ct.tenant_id IS NOT NULL
      AND is_tenant_member(ct.tenant_id)
  ));

-- Tags are the owner's labels; members may read them to tag contacts.
DROP POLICY IF EXISTS "Members view owner tags" ON tags;
CREATE POLICY "Members view owner tags" ON tags
  FOR SELECT USING (user_id IN (SELECT member_owner_user_ids()));

-- Names and emails of people on the same team (for the assign list).
DROP POLICY IF EXISTS "Teammates view profiles" ON profiles;
CREATE POLICY "Teammates view profiles" ON profiles
  FOR SELECT USING (user_id IN (SELECT teammate_user_ids()));
