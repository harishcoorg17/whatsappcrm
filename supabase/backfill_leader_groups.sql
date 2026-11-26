-- ============================================================
-- Backfill: push already-created leader groups to the CRM Groups page.
-- Run AFTER migration 058_whatsapp_groups_pending_link.sql.
--
-- The Amstago app and the CRM may be different databases, so this is two steps.
--
-- STEP 1 - run in the AMSTAGO database (community_trips lives there).
--   Copy the single text value it returns.
-- STEP 2 - paste that text into the CRM database's SQL editor and run it.
--
-- Mirrors the live sync: one pending row (no invite link) per leader-created
-- group, name "<title> (<start_date>)", capacity = min_pax * 2.
-- external_ref = community trip id, so re-running never creates duplicates.
-- ============================================================

-- ---------- STEP 1: run in the Amstago database ----------
-- Replace 'amstago' below with the CRM tenant slug if it differs.
SELECT string_agg(
  format(
    'INSERT INTO whatsapp_groups (tenant_id, kind, name, invite_url, description, capacity, departure_date, external_ref) '
    'SELECT t.id, ''group'', %L, NULL, %L, %s, %L, %L FROM crm_tenants t WHERE t.slug = ''amstago'' '
    'ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING;',
    left(ct.title || ' (' || ct.start_date::date || ')', 120),
    left('Group trip' || CASE WHEN ct.destination IS NOT NULL THEN '. ' || ct.destination ELSE '' END, 500),
    least(greatest(ct.min_pax * 2, 1), 1024),
    ct.start_date::date,
    ct.id::text
  ),
  E'\n' ORDER BY ct.created_at
) AS crm_insert_script
FROM community_trips ct
WHERE ct.start_date IS NOT NULL
  AND ct.min_pax >= 1
  AND ct.metadata->>'package_id' IS NOT NULL; -- trips made by the leader create-group flow

-- ---------- STEP 2: run in the CRM database ----------
-- Paste the script from step 1 and run it. Find the tenant slug with:
--   SELECT slug, name FROM crm_tenants;
-- Check afterwards:
--   SELECT name, departure_date, capacity FROM whatsapp_groups
--   WHERE external_ref IS NOT NULL ORDER BY created_at DESC;
