-- =============================================================
-- Amstago Travel — Initial CRM Data
-- Run this in the Supabase SQL editor at:
-- https://amstago-supabase-12772e-31-97-235-19.sslip.io/project/default/sql/
--
-- User (admin@amstago.com): dab74467-0e12-470c-98d0-ead84eb5b22a
-- Tenant (Amstago):         666ef1b8-8462-499f-b577-2f849602718f
-- =============================================================

DO $$
DECLARE
  v_user_id      UUID := 'dab74467-0e12-470c-98d0-ead84eb5b22a';
  v_tenant_id    UUID := '666ef1b8-8462-499f-b577-2f849602718f'; -- crm_tenants (pipelines/automations/flows)
  v_wa_tenant_id UUID := '00000000-0000-0000-0000-000000000001'; -- tenants table (broadcasts, whatsappagent)

  -- Pipeline IDs (stable so this script is idempotent)
  v_pipeline_leads  UUID := 'aaaaaaaa-0001-0000-0000-000000000001';
  v_pipeline_groups UUID := 'aaaaaaaa-0001-0000-0000-000000000002';

  -- Automation IDs
  v_auto_welcome    UUID := 'bbbbbbbb-0001-0000-0000-000000000001';
  v_auto_keywords   UUID := 'bbbbbbbb-0001-0000-0000-000000000002';
  v_auto_newtag     UUID := 'bbbbbbbb-0001-0000-0000-000000000003';

  -- Broadcast IDs
  v_bcast_welcome   UUID := 'cccccccc-0001-0000-0000-000000000001';
  v_bcast_offer     UUID := 'cccccccc-0001-0000-0000-000000000002';
  v_bcast_seasonal  UUID := 'cccccccc-0001-0000-0000-000000000003';

  -- Flow ID
  v_flow_inquiry    UUID := 'dddddddd-0001-0000-0000-000000000001';

BEGIN

-- =============================================================
-- 1. PIPELINES
-- =============================================================

INSERT INTO pipelines (id, user_id, tenant_id, name)
VALUES (v_pipeline_leads, v_user_id, v_tenant_id, 'Tour Leads')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pipeline_stages (pipeline_id, name, position, color) VALUES
  (v_pipeline_leads, 'New Inquiry',        0, '#6366f1'),
  (v_pipeline_leads, 'Qualified',          1, '#3b82f6'),
  (v_pipeline_leads, 'Proposal Sent',      2, '#f59e0b'),
  (v_pipeline_leads, 'Booking Confirmed',  3, '#10b981'),
  (v_pipeline_leads, 'Trip Completed',     4, '#22d3ee'),
  (v_pipeline_leads, 'Post-Trip Follow-up',5, '#a855f7')
ON CONFLICT DO NOTHING;

INSERT INTO pipelines (id, user_id, tenant_id, name)
VALUES (v_pipeline_groups, v_user_id, v_tenant_id, 'Group Trips')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pipeline_stages (pipeline_id, name, position, color) VALUES
  (v_pipeline_groups, 'Group Inquiry',          0, '#6366f1'),
  (v_pipeline_groups, 'Requirements Gathering', 1, '#8b5cf6'),
  (v_pipeline_groups, 'Proposal Sent',          2, '#f59e0b'),
  (v_pipeline_groups, 'Deposit Received',       3, '#10b981'),
  (v_pipeline_groups, 'Fully Confirmed',        4, '#22d3ee'),
  (v_pipeline_groups, 'Trip Completed',         5, '#a855f7')
ON CONFLICT DO NOTHING;

-- =============================================================
-- 2. AUTOMATIONS
-- =============================================================

-- NOTE: migration 023_fix_schema_gaps.sql uses:
--   automations.enabled (not is_active)
--   automations.last_triggered (not last_executed_at)
--   automation_steps.type (not step_type)
--   automation_steps.config (not step_config)

-- 2a. Welcome on first inbound message
INSERT INTO automations (id, user_id, tenant_id, name, description, trigger_type, trigger_config, enabled)
VALUES (
  v_auto_welcome,
  v_user_id,
  v_tenant_id,
  'Welcome — First Message',
  'Greets every new customer the first time they message Amstago on WhatsApp.',
  'first_inbound_message',
  '{}'::jsonb,
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO automation_steps (automation_id, type, config, position) VALUES
  (v_auto_welcome, 'send_template', '{
    "template_name": "amstago_welcome",
    "template_language": "en",
    "variables": []
  }'::jsonb, 0),
  (v_auto_welcome, 'add_tag', '{"tag": "New Lead"}'::jsonb, 1)
ON CONFLICT DO NOTHING;

-- 2b. Tour inquiry keyword auto-reply
INSERT INTO automations (id, user_id, tenant_id, name, description, trigger_type, trigger_config, enabled)
VALUES (
  v_auto_keywords,
  v_user_id,
  v_tenant_id,
  'Tour Info — Keyword Reply',
  'Auto-replies when a customer asks about tours, packages, or bookings.',
  'keyword_match',
  '{
    "keywords": ["tour", "package", "trip", "travel", "book", "booking", "itinerary", "price", "cost", "deal"],
    "match_type": "any"
  }'::jsonb,
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO automation_steps (automation_id, type, config, position) VALUES
  (v_auto_keywords, 'send_message', '{
    "message": "Hi! 👋 Thanks for reaching out to Amstago Travel.\n\nWe offer handcrafted tour packages across India and beyond:\n\n🏔️ *Adventure Tours* — Himalayas, North-East, Ladakh\n🏖️ *Beach Escapes* — Goa, Kerala, Andaman\n🕌 *Heritage Trails* — Rajasthan, Tamil Nadu\n✈️ *International Packages* — Bali, Thailand, Europe\n\nReply with your destination interest and our team will get back to you shortly!"
  }'::jsonb, 0),
  (v_auto_keywords, 'add_tag', '{"tag": "Tour Interest"}'::jsonb, 1)
ON CONFLICT DO NOTHING;

-- 2c. Auto-tag new contacts
INSERT INTO automations (id, user_id, tenant_id, name, description, trigger_type, trigger_config, enabled)
VALUES (
  v_auto_newtag,
  v_user_id,
  v_tenant_id,
  'New Contact — Auto Tag',
  'Tags every new contact as a Lead when they are first added to the CRM.',
  'new_contact_created',
  '{}'::jsonb,
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO automation_steps (automation_id, type, config, position) VALUES
  (v_auto_newtag, 'add_tag', '{"tag": "Lead"}'::jsonb, 0)
ON CONFLICT DO NOTHING;

-- =============================================================
-- 3. BROADCASTS (drafts — schedule or send from the UI)
-- Live schema: id, tenant_id, template_id(opt), name, target_type,
--   target_tags[], target_phones[], status, total_count, sent_count,
--   delivered_count, failed_count, total_recipients, scheduled_at,
--   started_at, completed_at, error_message, created_at, updated_at
-- =============================================================

INSERT INTO broadcasts (id, tenant_id, name, target_type, target_tags, target_phones, status,
                        total_count, sent_count, delivered_count, failed_count, total_recipients)
VALUES (
  v_bcast_welcome, v_wa_tenant_id,
  'Welcome Campaign — All Contacts',
  'all', '{}', '{}', 'draft', 0, 0, 0, 0, 0
) ON CONFLICT (id) DO NOTHING;

INSERT INTO broadcasts (id, tenant_id, name, target_type, target_tags, target_phones, status,
                        total_count, sent_count, delivered_count, failed_count, total_recipients)
VALUES (
  v_bcast_offer, v_wa_tenant_id,
  'Special Offer — Early Bird 2027',
  'all', '{}', '{}', 'draft', 0, 0, 0, 0, 0
) ON CONFLICT (id) DO NOTHING;

INSERT INTO broadcasts (id, tenant_id, name, target_type, target_tags, target_phones, status,
                        total_count, sent_count, delivered_count, failed_count, total_recipients)
VALUES (
  v_bcast_seasonal, v_wa_tenant_id,
  'Seasonal Promo — Festive Getaways',
  'all', '{}', '{}', 'draft', 0, 0, 0, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- 4. FLOWS (skipped if migration 010_flows.sql hasn't been run)
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='flows') THEN
  RAISE NOTICE 'flows table not found — skipping flow inserts. Run migration 010_flows.sql first.';
ELSE

INSERT INTO flows (id, user_id, name, description, status, trigger_type, trigger_config, entry_node_id)
VALUES (
  v_flow_inquiry,
  v_user_id,
  'Tour Inquiry Flow',
  'Qualifies every new lead — collects destination, travel dates, and group size, then hands off to the inbox.',
  'draft',
  'first_inbound_message',
  '{}'::jsonb,
  'greet'
) ON CONFLICT (id) DO NOTHING;

-- Edges live INSIDE each node's config JSONB via next_node_key
-- (see migration 010_flows.sql design notes — no separate flow_edges table)
INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y) VALUES

  (v_flow_inquiry, 'start', 'start',
   '{"next_node_key": "greet"}'::jsonb,
   0, 0),

  (v_flow_inquiry, 'greet', 'send_buttons',
   '{
     "body": "👋 Welcome to *Amstago Travel*!\n\nWe create unforgettable journeys. What are you looking for?",
     "buttons": [
       {"id": "domestic",      "title": "Domestic Tours 🇮🇳",   "next_node_key": "ask_destination"},
       {"id": "international", "title": "International Tours ✈️", "next_node_key": "ask_destination"},
       {"id": "group",         "title": "Group / Corporate 🏢",  "next_node_key": "ask_destination"}
     ]
   }'::jsonb,
   0, 100),

  (v_flow_inquiry, 'ask_destination', 'collect_input',
   '{
     "prompt": "Great! 🗺️ Which destination or region interests you? (e.g. Himachal, Kerala, Bali, Europe)",
     "field_name": "destination",
     "input_type": "text",
     "next_node_key": "ask_dates"
   }'::jsonb,
   0, 200),

  (v_flow_inquiry, 'ask_dates', 'collect_input',
   '{
     "prompt": "📅 When are you planning to travel? Please share your preferred month or date range.",
     "field_name": "travel_dates",
     "input_type": "text",
     "next_node_key": "ask_group_size"
   }'::jsonb,
   0, 300),

  (v_flow_inquiry, 'ask_group_size', 'collect_input',
   '{
     "prompt": "👥 How many travellers will be joining? (adults + children)",
     "field_name": "group_size",
     "input_type": "text",
     "next_node_key": "tag_qualified"
   }'::jsonb,
   0, 400),

  (v_flow_inquiry, 'tag_qualified', 'set_tag',
   '{
     "tag": "Qualified Lead",
     "next_node_key": "handoff"
   }'::jsonb,
   0, 500),

  (v_flow_inquiry, 'handoff', 'handoff',
   '{
     "message": "✅ Perfect! Our travel expert will reach out within *2 hours* with tailored recommendations.\n\nExplore our packages at *amstago.com* 🌍",
     "next_node_key": "end"
   }'::jsonb,
   0, 600),

  (v_flow_inquiry, 'end', 'end', '{}'::jsonb, 0, 700)

ON CONFLICT DO NOTHING;

END IF; -- flows table existence check

RAISE NOTICE '✅  Amstago initial CRM data inserted.';
RAISE NOTICE '   Pipelines:    Tour Leads (6 stages), Group Trips (6 stages)';
RAISE NOTICE '   Automations:  Welcome, Tour Keywords, New Contact Tag (all active)';
RAISE NOTICE '   Broadcasts:   3 draft campaigns (Welcome, Special Offer, Seasonal)';
RAISE NOTICE '   Flows:        Tour Inquiry Flow (draft — activate when ready)';

END $$;
