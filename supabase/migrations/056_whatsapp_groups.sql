-- ============================================================
-- 056_whatsapp_groups.sql
-- Registry of WhatsApp groups and channels.
--
-- Meta's Cloud API cannot create channels, and only creates groups for
-- Official Business Accounts, so the owner creates each group / channel by
-- hand in the WhatsApp app and pastes the invite link here. ConverMesh keeps
-- the link per trip and sends it to the right contacts.
--
--   whatsapp_groups         one row per group (departure) or channel
--   whatsapp_group_invites  who was sent which link, and a manual
--                           'joined' / 'left' mark (WhatsApp never tells
--                           the Cloud API who joined)
--
-- Members of the tenant (owner, admins, agents) can read and write.
-- Server routes use the service role and also check access themselves.
-- Idempotent: safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('group', 'channel')),
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  invite_url     TEXT NOT NULL CHECK (
    char_length(invite_url) <= 300
    AND (
      (kind = 'group'   AND invite_url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9_-]+$')
      OR
      (kind = 'channel' AND invite_url ~ '^https://whatsapp\.com/channel/[A-Za-z0-9_-]+$')
    )
  ),
  description    TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  capacity       INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 1024),
  departure_date DATE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_tenant
  ON whatsapp_groups (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_group_invites (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id    UUID NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'joined', 'left')),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_group_invites_contact
  ON whatsapp_group_invites (contact_id);

-- ── Row level security ──────────────────────────────────────────────────────
-- Tenant owners are not rows in crm_tenant_members, so owners are matched
-- through crm_tenants; team members through is_tenant_member() (030).

ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_group_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members manage whatsapp groups" ON whatsapp_groups;
CREATE POLICY "Tenant members manage whatsapp groups" ON whatsapp_groups
  FOR ALL
  USING (
    is_tenant_member(tenant_id)
    OR tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    is_tenant_member(tenant_id)
    OR tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Platform admins manage whatsapp groups" ON whatsapp_groups;
CREATE POLICY "Platform admins manage whatsapp groups" ON whatsapp_groups
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "Tenant members manage group invites" ON whatsapp_group_invites;
CREATE POLICY "Tenant members manage group invites" ON whatsapp_group_invites
  FOR ALL
  USING (
    group_id IN (
      SELECT g.id FROM whatsapp_groups g
      WHERE is_tenant_member(g.tenant_id)
         OR g.tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT g.id FROM whatsapp_groups g
      WHERE is_tenant_member(g.tenant_id)
         OR g.tenant_id IN (SELECT id FROM crm_tenants WHERE owner_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Platform admins manage group invites" ON whatsapp_group_invites;
CREATE POLICY "Platform admins manage group invites" ON whatsapp_group_invites
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
