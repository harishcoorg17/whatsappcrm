-- ============================================================
-- 057_platform_admin_read.sql
-- Lets platform admins (crm_platform_admins) READ every tenant's data.
--
-- Read-only on purpose: only SELECT policies are added, so an admin browsing a
-- customer's account cannot edit, send or delete anything as that customer.
-- whatsapp_config is left out: it holds the encrypted access token.
--
-- Additive and safe to re-run. Tables that do not exist are skipped.
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'conversations', 'messages', 'message_reactions',
    'contact_notes', 'contact_tags', 'tags',
    'custom_fields', 'contact_custom_values',
    'message_templates',
    'pipelines', 'pipeline_stages', 'deals',
    'broadcasts', 'broadcast_recipients',
    'flows', 'canned_replies'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS "Platform admins read all" ON %I', t
      );
      EXECUTE format(
        'CREATE POLICY "Platform admins read all" ON %I FOR SELECT USING (is_platform_admin())',
        t
      );
    END IF;
  END LOOP;
END $$;
