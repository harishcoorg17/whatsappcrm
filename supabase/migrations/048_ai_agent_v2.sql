-- When an agent hands a chat back to the bot, the AI agent should answer
-- again straight away instead of waiting out its "a human just replied"
-- pause. The inbox stamps this column on "Return to bot"; the AI then ignores
-- human messages sent before it. Nothing else reads it.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_resumed_at timestamptz;

-- Lead capture: lets the AI save the destination, dates, group size and
-- budget a customer mentions onto the contact (as ordinary custom fields),
-- and tag the contact 'ai-lead' once enough is known. Off until a tenant
-- turns it on in the AI settings.

ALTER TABLE crm_tenants
  ADD COLUMN IF NOT EXISTS ai_lead_capture boolean NOT NULL DEFAULT false;
