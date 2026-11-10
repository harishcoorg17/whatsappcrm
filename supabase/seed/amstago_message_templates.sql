-- ============================================================
-- Amstago WhatsApp message templates (22) — saved as DRAFT
--
-- What this does
--   Inserts the Amstago template catalogue into message_templates for the
--   Amstago tenant's owner. Nothing is sent to Meta: each row is a DRAFT you
--   review, then submit from Templates → Submit (or edit first).
--
-- Safe to re-run
--   Rows that already exist for the same (user, name, language) are skipped,
--   so templates you have edited, submitted or synced from Meta are never
--   overwritten.
--
-- Before you run it
--   * The owner is looked up from the tenant slug below. Change it if your
--     Amstago tenant slug is different.
--   * Button links point at https://amstago.com. Check the paths.
--   * Review the copy: Meta approves on wording, and Utility templates must
--     stay factual (no offers), or Meta may reclassify them as Marketing.
--   * "otp_login" (Authentication) is not included: it needs Meta's own
--     authentication format, which this template builder does not support.
--
-- Every template here passes the app's validateTemplatePayload() rules.
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
    -- tour_purchase_confirmation (Utility) · Booking paid
    ('tour_purchase_confirmation', 'Utility', 'en_US', 'text',
     $t$Booking confirmed ✅$t$,
     $t$Hi {{1}}, thank you for booking with Amstago! 🎉

Your trip is confirmed:
• Tour: {{2}}
• Dates: {{3}}
• Travellers: {{4}}
• Booking ID: {{5}}
• Amount paid: {{6}}

Our team will share your detailed itinerary and packing checklist soon. You can see your booking any time using the button below.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Talk to our team"},{"type":"URL","text":"View booking","url":"https://amstago.com/my-profile"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","14–18 Dec 2026","2 adults","AMS-10482","₹29,404"]}$j$::jsonb),
    -- tour_group_invite_notice (Utility) · Right after purchase
    ('tour_group_invite_notice', 'Utility', 'en_US', 'text',
     $t$Your trip group 🧳$t$,
     $t$Hi {{1}}, great news! To keep everyone connected before and during your {{2}} trip, we are inviting you to the WhatsApp group "{{3}}".

Your tour leader, {{4}}, will use it for departure details, meeting points and travel updates, and you can meet your co-travellers there.

Tap the button below to join. If you would rather not be in the group, just tell us and we will sort it out.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Don't add me"},{"type":"URL","text":"Join group","url":"https://chat.whatsapp.com/{{1}}","example":"AbCdEf123456"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","Kerala 14 Dec Group","Rahul"]}$j$::jsonb),
    -- payment_pending_reminder (Utility) · Booking unpaid or balance due
    ('payment_pending_reminder', 'Utility', 'en_US', 'text',
     $t$Payment reminder$t$,
     $t$Hi {{1}}, this is a friendly reminder that a payment of {{2}} for your {{3}} trip is due by {{4}}.

To keep your spot confirmed, please complete the payment using the button below. If you have already paid, please ignore this message.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"I need help"},{"type":"URL","text":"Complete payment","url":"https://amstago.com/booking/tour/{{1}}","example":"kerala-hills-backwaters"}]$j$::jsonb,
     $j${"body":["Asha","₹14,702","Kerala Hills & Backwaters","5 Dec 2026"]}$j$::jsonb),
    -- payment_failed (Utility) · Payment did not go through
    ('payment_failed', 'Utility', 'en_US', 'text',
     $t$Payment unsuccessful$t$,
     $t$Hi {{1}}, your payment of {{2}} for {{3}} could not be completed, so your booking is not confirmed yet.

Please try again using the button below. If money was deducted from your account, it is usually returned automatically by your bank within a few working days.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Talk to our team"},{"type":"URL","text":"Try again","url":"https://amstago.com/booking/tour/{{1}}","example":"kerala-hills-backwaters"}]$j$::jsonb,
     $j${"body":["Asha","₹29,404","Kerala Hills & Backwaters"]}$j$::jsonb),
    -- booking_changed_or_cancelled (Utility) · Date or tour changed, or cancelled
    ('booking_changed_or_cancelled', 'Utility', 'en_US', 'text',
     $t$Booking update$t$,
     $t$Hi {{1}}, there is an update to your booking {{2}} for {{3}}.

What changed: {{4}}

If you have any questions, tap a button below and our team will help you.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Talk to our team"},{"type":"QUICK_REPLY","text":"Looks good"}]$j$::jsonb,
     $j${"body":["Asha","AMS-10482","Kerala Hills & Backwaters","Departure moved to 20 Dec 2026"]}$j$::jsonb),
    -- refund_processed (Utility) · Refund issued
    ('refund_processed', 'Utility', 'en_US', 'text',
     $t$Refund processed$t$,
     $t$Hi {{1}}, we have processed a refund of {{2}} for booking {{3}}.

It should reach your original payment method within {{4}}. If you do not see it after that, please reply to this message and we will look into it.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Contact support"}]$j$::jsonb,
     $j${"body":["Asha","₹14,702","AMS-10482","5–7 working days"]}$j$::jsonb),
    -- itinerary_ready (Utility) · Itinerary finalised
    ('itinerary_ready', 'Utility', 'en_US', 'text',
     $t$Your itinerary is ready 🗺️$t$,
     $t$Hi {{1}}, the day-by-day itinerary for your {{2}} trip is ready.

It includes your schedule, stays and key details. Please review it and let us know if anything looks different from what you expected.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Ask a question"},{"type":"URL","text":"View itinerary","url":"https://amstago.com/tours/{{1}}","example":"kerala-hills-backwaters"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters"]}$j$::jsonb),
    -- pre_trip_checklist (Utility) · 7 days before departure
    ('pre_trip_checklist', 'Utility', 'en_US', 'text',
     $t$One week to go! 🧳$t$,
     $t$Hi {{1}}, your {{2}} trip starts in {{3}} days.

Here is a quick checklist to get ready:
• Carry a valid photo ID
• Keep a printed or saved copy of your booking
• Pack light and check the weather for {{4}}

We are excited to travel with you!$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Got it"},{"type":"QUICK_REPLY","text":"I have a question"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","7","Munnar"]}$j$::jsonb),
    -- departure_reminder (Utility) · 1–2 days before departure
    ('departure_reminder', 'Utility', 'en_US', 'text',
     $t$Departure reminder ⏰$t$,
     $t$Hi {{1}}, your {{2}} trip departs on {{3}}.

Meeting point: {{4}}
Reporting time: {{5}}
Your tour leader: {{6}} ({{7}})

Please arrive on time and keep your booking ID handy. Have a wonderful trip!$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"I'll be there"},{"type":"QUICK_REPLY","text":"I need help"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","14 Dec 2026","Cochin Airport, Gate 2","6:30 AM","Rahul","+91 90000 00000"]}$j$::jsonb),
    -- document_request (Utility) · A document is missing
    ('document_request', 'Utility', 'en_US', 'text',
     $t$Documents needed 📄$t$,
     $t$Hi {{1}}, to finalise your {{2}} trip we still need your {{3}}.

Please share it by {{4}}. You can reply here with a clear photo or PDF, or upload it using the button below.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Need help"},{"type":"URL","text":"Upload document","url":"https://amstago.com/my-profile"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","photo ID proof","8 Dec 2026"]}$j$::jsonb),
    -- trip_started_welcome (Utility) · Day 1 of the trip
    ('trip_started_welcome', 'Utility', 'en_US', 'text',
     $t$Welcome aboard! 🎉$t$,
     $t$Hi {{1}}, your {{2}} adventure begins today!

Your tour leader, {{3}}, is your point of contact throughout the trip and will keep you updated in the group. If you need anything, just reply to this message.

Safe travels and enjoy every moment!$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Need assistance"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","Rahul"]}$j$::jsonb),
    -- review_request (Utility) · 1–2 days after the trip
    ('review_request', 'Utility', 'en_US', 'text',
     $t$How was your trip? ⭐$t$,
     $t$Hi {{1}}, we hope you had a wonderful time on your {{2}} trip!

Your feedback helps other travellers choose with confidence and helps us improve. It takes less than a minute.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Maybe later"},{"type":"URL","text":"Leave a review","url":"https://amstago.com/tours/{{1}}","example":"kerala-hills-backwaters"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters"]}$j$::jsonb),
    -- miles_earned (Utility) · Travel Miles credited
    ('miles_earned', 'Utility', 'en_US', 'text',
     $t$Travel Miles added ✈️$t$,
     $t$Hi {{1}}, you earned {{2}} Travel Miles for your {{3}} trip.

Your new balance is {{4}} miles. You can see your balance any time in your Amstago profile.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"URL","text":"View my miles","url":"https://amstago.com/my-profile"}]$j$::jsonb,
     $j${"body":["Asha","500","Kerala Hills & Backwaters","1,250"]}$j$::jsonb),
    -- travel_wrapped (Marketing) · Year-end
    ('travel_wrapped', 'Marketing', 'en_US', 'text',
     $t$Your Travel Wrapped is here 🎁$t$,
     $t$Hi {{1}}, your {{2}} travel year is ready!

See the places you explored, the miles you earned and the moments that made your year. Tap below to view and share your Wrapped.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Stop updates"},{"type":"URL","text":"View my Wrapped","url":"https://amstago.com/wrapped/{{1}}","example":"2026/user-123"}]$j$::jsonb,
     $j${"body":["Asha","2026"]}$j$::jsonb),
    -- leader_tour_assigned (Utility) · A tour is assigned to a leader
    ('leader_tour_assigned', 'Utility', 'en_US', 'text',
     $t$New tour assigned 🧭$t$,
     $t$Hi {{1}}, you have been assigned as the tour leader for {{2}}.

Dates: {{3}}
Starting from: {{4}}

Please review the details and confirm in your Leader Portal.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Confirm"},{"type":"URL","text":"Open Leader Portal","url":"https://amstago.com/leader/trips"}]$j$::jsonb,
     $j${"body":["Rahul","Kerala Hills & Backwaters","14–18 Dec 2026","Cochin"]}$j$::jsonb),
    -- leader_new_booking (Utility) · A traveller books a leader’s tour
    ('leader_new_booking', 'Utility', 'en_US', 'text',
     $t$New booking 🎉$t$,
     $t$Hi {{1}}, {{2}} has just booked your {{3}} tour.

Travellers on this booking: {{4}}
Total confirmed so far: {{5}}

You can view the full list in your Leader Portal.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"URL","text":"View bookings","url":"https://amstago.com/leader/trips"}]$j$::jsonb,
     $j${"body":["Rahul","Asha","Kerala Hills & Backwaters","2","9"]}$j$::jsonb),
    -- leader_earnings_update (Utility) · Bonus or payout posted
    ('leader_earnings_update', 'Utility', 'en_US', 'text',
     $t$Earnings update 💰$t$,
     $t$Hi {{1}}, {{2}} has been credited to your Leader Earnings for {{3}}.

Your current rank is {{4}}. You can view the full breakdown in your Leader Portal.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"URL","text":"View earnings","url":"https://amstago.com/leader/earnings"}]$j$::jsonb,
     $j${"body":["Rahul","₹4,500","Kerala Hills & Backwaters","Captain"]}$j$::jsonb),
    -- new_departure_alert (Marketing) · New departure on a saved destination
    ('new_departure_alert', 'Marketing', 'en_US', 'text',
     $t$New departure alert ✈️$t$,
     $t$Hi {{1}}, a new departure for {{2}} has just opened!

Dates: {{3}}
Starting from: {{4}}

Seats are limited, so tap below to see the full itinerary and reserve your spot.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Stop updates"},{"type":"URL","text":"View trip","url":"https://amstago.com/tours/{{1}}","example":"kerala-hills-backwaters"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters","14–18 Dec 2026","Cochin"]}$j$::jsonb),
    -- abandoned_booking_nudge (Marketing) · Started booking, did not finish
    ('abandoned_booking_nudge', 'Marketing', 'en_US', 'text',
     $t$Still planning your trip?$t$,
     $t$Hi {{1}}, you were just a step away from booking {{2}}.

Your selected dates are still available for now. Tap below to pick up where you left off, or reply if you need any help.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Stop updates"},{"type":"URL","text":"Continue booking","url":"https://amstago.com/booking/tour/{{1}}","example":"kerala-hills-backwaters"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters"]}$j$::jsonb),
    -- trip_twins_invite (Marketing) · Matching traveller or group found
    ('trip_twins_invite', 'Marketing', 'en_US', 'text',
     $t$Travellers like you ✨$t$,
     $t$Hi {{1}}, we found travellers with a similar plan to yours for {{2}}.

See who is going and join the trip to travel together. Tap below to take a look.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Stop updates"},{"type":"URL","text":"See the trip","url":"https://amstago.com/community-trips/{{1}}","example":"trip-1234"}]$j$::jsonb,
     $j${"body":["Asha","Kerala Hills & Backwaters"]}$j$::jsonb),
    -- challenge_reminder (Marketing) · Challenge nearing its end
    ('challenge_reminder', 'Marketing', 'en_US', 'text',
     $t$Challenge ending soon ⏳$t$,
     $t$Hi {{1}}, the {{2}} challenge ends on {{3}}.

There is still time to join in and submit your entry. Tap below to see the details.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Stop updates"},{"type":"URL","text":"View challenge","url":"https://amstago.com/challenges/{{1}}","example":"challenge-1234"}]$j$::jsonb,
     $j${"body":["Asha","Monsoon Memories","30 Nov 2026"]}$j$::jsonb),
    -- support_followup (Utility) · Agent follows up after the 24-hour window
    ('support_followup', 'Utility', 'en_US', 'text',
     $t$Following up on your query$t$,
     $t$Hi {{1}}, this is {{2}} from Amstago following up on your recent query about {{3}}.

Please reply to this message and we will pick up right where we left off.$t$,
     $t$Amstago · Travel made social$t$,
     $j$[{"type":"QUICK_REPLY","text":"Yes, please continue"}]$j$::jsonb,
     $j${"body":["Asha","Priya","your Kerala trip"]}$j$::jsonb)
  ) AS t(name, category, language, header_type, header_content,
         body_text, footer_text, buttons, sample_values)
ON CONFLICT (user_id, name, language) DO NOTHING;

-- Check the result
SELECT name, category, status
FROM message_templates
WHERE user_id = (SELECT owner_user_id FROM crm_tenants WHERE slug = 'amstago-tours')
ORDER BY category, name;
