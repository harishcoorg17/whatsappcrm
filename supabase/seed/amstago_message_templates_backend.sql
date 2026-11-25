-- ============================================================
-- Amstago WhatsApp templates the Backend sends by name (7) — saved as DRAFT
--
-- Only templates with NO equivalent in amstago_message_templates.sql or in the
-- live message_templates table are listed here. Templates whose purpose is
-- already covered (document reminder, trip kickoff, review request, leader
-- booking alert, leader payout, abandoned booking nudge) are deliberately NOT
-- duplicated: the Backend now sends those existing templates (proactive.ts).
--
-- Every variable is a BODY variable, because the Backend sends body parameters
-- only. Buttons therefore must be quick replies or static URLs (no {{1}} in a
-- URL), or the send would fail.
--
-- Safe to re-run: rows that already exist for (user, name, language) are skipped.
-- Nothing is sent to Meta; review each draft, then submit from Templates → Submit.
-- Utility templates must stay factual (no offers) or Meta may reclassify them.
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
  body_text, footer_text, buttons, sample_values, status
)
SELECT
  owner.id, t.name, t.category, t.language, t.header_type, t.header_content,
  t.body_text, t.footer_text, t.buttons, t.sample_values, 'DRAFT'
FROM owner,
  (VALUES
    -- amstago_quote_ready (Utility) · Backend: quoteWhatsapp.ts, quote delivered to the traveller
    ('amstago_quote_ready', 'Utility', 'en_US', 'text',
     $t$Your quote is ready$t$,
     $t$Hi {{1}}, your quote for {{2}} is ready.

Total price: {{3}}
View your quote: {{4}}
Download the PDF: {{5}}

Reply here if you would like to change anything.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Talk to our team"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","₹29,404","https://amstago.com/quote/abc123","https://amstago.com/quote/abc123.pdf"]}$j$::jsonb),
    -- amstago_payment_request (Utility) · Backend: quoteWhatsapp.ts, payment link sent to the traveller
    ('amstago_payment_request', 'Utility', 'en_US', 'text',
     $t$Payment request$t$,
     $t$Hi {{1}}, here is your payment request for {{2}}.

Amount due: {{3}}
Pay securely: {{4}}
Invoice: {{5}}

If you have already paid, please ignore this message.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"I need help"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","₹14,702","https://amstago.com/pay/abc123","https://amstago.com/invoice/abc123"]}$j$::jsonb),
    -- amstago_dmc_quote_request (Utility) · Backend: dmcRequestWhatsapp.ts, rate request to a DMC
    ('amstago_dmc_quote_request', 'Utility', 'en_US', 'text',
     $t$Quote request$t$,
     $t$Hi {{1}}, Amstago needs your best net rate for request {{2}}: {{3}}, {{4}}, {{5}}, covering {{6}}.

The full day-wise plan, hotels and transport are in our email. Please reply quoting the request reference above.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Will quote"},{"type":"QUICK_REPLY","text":"Cannot quote"}]$j$::jsonb,
     $j${"body":["Ravi","RFQ-7B0F89DF","7-Day Andaman Circuit","14 Dec 2026 · 7 days","2 adults","Port Blair, Havelock, Neil Island"]}$j$::jsonb),
    -- amstago_admin_new_booking (Utility) · Backend: adminBookingAlerts.ts, internal alert to admins
    ('amstago_admin_new_booking', 'Utility', 'en_US', 'text',
     $t$New booking$t$,
     $t$New booking: {{1}} has booked {{2}}.

Start date: {{3}}
Travellers: {{4}}
Paid: {{5}}
Balance: {{6}}
Booking ID: {{7}}

Open the Admin portal to review it.$t$,
     $t$Amstago · Internal alert$t$,
     '[]'::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","14 Dec 2026","2","₹14,702","₹14,702","AMS-1048"]}$j$::jsonb),
    -- amstago_saved_tour_fixed (Marketing) · Backend: savedTourReminders.ts, saved tour with a fixed departure
    ('amstago_saved_tour_fixed', 'Marketing', 'en_US', 'text',
     $t$Your saved tour is filling up$t$,
     $t$Good news! {{1}}, a tour you saved, departs on {{2}} and spots are filling up.

Book soon to keep your place. Reply here if you have any questions.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Stop updates"}]$j$::jsonb,
     $j${"body":["Kerala Hills & Backwaters","14 Dec 2026"]}$j$::jsonb),
    -- amstago_saved_tour_flexible (Marketing) · Backend: savedTourReminders.ts, saved tour with flexible dates
    ('amstago_saved_tour_flexible', 'Marketing', 'en_US', 'text',
     $t$Interest is growing$t$,
     $t$Interest is growing: {{1}} travellers have saved {{2}}, which you saved too.

We are considering opening a new departure. Tell us your preferred dates and we will let you know.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Stop updates"}]$j$::jsonb,
     $j${"body":["12","Kerala Hills & Backwaters"]}$j$::jsonb),
    -- complete_profile (Marketing) · Backend: proactive.ts, welcome nudge after sign-up
    ('complete_profile', 'Marketing', 'en_US', 'text',
     $t$Welcome to Amstago$t$,
     $t$Hi {{1}}, welcome to Amstago!

Complete your profile so we can suggest trips and travel companions that suit you. It only takes a minute.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Stop updates"}]$j$::jsonb,
     $j${"body":["Asha"]}$j$::jsonb)
  ) AS t(name, category, language, header_type, header_content,
         body_text, footer_text, buttons, sample_values)
ON CONFLICT (user_id, name, language) DO NOTHING;

-- Check the result
SELECT name, category, status
FROM message_templates
WHERE user_id = (SELECT owner_user_id FROM crm_tenants WHERE slug = 'amstago-tours')
  AND name IN ('amstago_quote_ready', 'amstago_payment_request', 'amstago_dmc_quote_request',
               'amstago_admin_new_booking', 'amstago_saved_tour_fixed',
               'amstago_saved_tour_flexible', 'complete_profile')
ORDER BY category, name;
