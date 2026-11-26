-- ============================================================
-- Amstago tour-leader reminder templates (3) — already submitted to Meta (PENDING review)
--
-- The Backend sends these by name through POST /api/integrations/send-template when a tour
-- leader presses a reminder button (Backend: leaderMembers.ts / leaderTravellers.ts).
-- Variables, in order: {{1}} traveller, {{2}} trip, {{3}} detail, {{4}} tour leader.
--
-- They were created directly on the Meta account, so these rows are stored as PENDING with the
-- Meta template ids. Do NOT press "Submit" in the CRM for them: Meta would reject the duplicate name.
-- When Meta approves them, use Templates → Sync to flip the status to APPROVED.
--
-- Safe to re-run: existing rows keep their status, and a DRAFT row is moved to PENDING.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM crm_tenants
    WHERE slug = 'amstago-tours' AND owner_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'No tenant with slug "amstago-tours" and an owner was found. Edit the slug in this file.';
  END IF;
END $$;

WITH owner AS (
  SELECT owner_user_id AS id
  FROM crm_tenants
  WHERE slug = 'amstago-tours'
)
INSERT INTO message_templates (
  user_id, name, category, language, header_type, header_content,
  body_text, footer_text, buttons, sample_values, status, meta_template_id, last_submitted_at
)
SELECT
  owner.id, t.name, 'Utility', 'en_US', NULL, NULL,
  t.body_text, NULL, NULL, t.sample_values, 'PENDING', t.meta_template_id, NOW()
FROM owner,
  (VALUES
    -- Missing documents · sent privately to one traveller
    ('amstago_leader_docs_reminder', '2523183761541094',
     $t$Hi {{1}}, this is {{4}}, your tour leader for {{2}}. We still need these from you: {{3}}. Please upload them in your Amstago profile or reply here.$t$,
     $j${"body":["Harish","Andaman Adventures","Passport","Ravi"]}$j$::jsonb),
    -- Balance due · sent privately to one traveller
    ('amstago_leader_payment_reminder', '4566958066909523',
     $t$Hi {{1}}, a reminder from {{4}} for {{2}}: your balance of {{3}} is due. Please complete the payment on Amstago or reply here if you need help.$t$,
     $j${"body":["Harish","Andaman Adventures","Rs 18,555","Ravi"]}$j$::jsonb),
    -- Departure details · sent privately to each traveller
    ('amstago_leader_departure_reminder', '4843382029228557',
     $t$Hi {{1}}, {{4}} here. {{2}} departs on {{3}}. Please keep your documents and luggage ready, and reply here with any questions.$t$,
     $j${"body":["Harish","Andaman Adventures","2026-11-27","Ravi"]}$j$::jsonb)
  ) AS t(name, meta_template_id, body_text, sample_values)
ON CONFLICT (user_id, name, language) DO UPDATE
  SET meta_template_id = EXCLUDED.meta_template_id,
      status = CASE WHEN message_templates.status = 'DRAFT' THEN 'PENDING' ELSE message_templates.status END;

-- Check the result
SELECT name, category, status, meta_template_id
FROM message_templates
WHERE user_id = (SELECT owner_user_id FROM crm_tenants WHERE slug = 'amstago-tours')
  AND name IN ('amstago_leader_docs_reminder', 'amstago_leader_payment_reminder', 'amstago_leader_departure_reminder')
ORDER BY name;
