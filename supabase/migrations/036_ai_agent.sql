-- AI agent: answers customers on a tenant's numbers, hands off to a human
-- when it cannot. Off until the tenant turns it on and adds a provider key.
--
-- Each tenant brings its own provider (anthropic, openai, openrouter,
-- gemini), model and API key. The key is stored encrypted (same AES-GCM
-- scheme as WhatsApp tokens) and is never sent back to the browser.

ALTER TABLE crm_tenants
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_provider text
    CHECK (ai_provider IN ('anthropic', 'openai', 'openrouter', 'gemini')),
  ADD COLUMN IF NOT EXISTS ai_model text
    CHECK (char_length(ai_model) <= 120),
  ADD COLUMN IF NOT EXISTS ai_api_key_enc text,
  ADD COLUMN IF NOT EXISTS ai_instructions text
    CHECK (char_length(ai_instructions) <= 2000),
  ADD COLUMN IF NOT EXISTS ai_knowledge text
    CHECK (char_length(ai_knowledge) <= 20000);
