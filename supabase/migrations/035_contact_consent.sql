-- ============================================================
-- 035_contact_consent.sql
-- Opt-in / opt-out for marketing messages.
--
--   contacts.opt_in_status  'unknown' (default, nothing recorded), 'opted_in'
--                           or 'opted_out'. Opted-out contacts are never sent
--                           broadcasts, and a customer can opt out by sending
--                           STOP (and back in with START).
--   contacts.opt_in_at / opt_out_at / consent_source  when and how it changed
--                           ('keyword', 'manual', 'import', ...).
--   contact_consent_events  an append-only log of every change, so you can
--                           show WhatsApp or a regulator proof of consent.
--
-- Existing contacts stay 'unknown'; nothing is blocked until someone opts out.
--
-- Idempotent: safe to run more than once.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opt_in_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS opt_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opt_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_source TEXT;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_opt_in_status_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_opt_in_status_check
  CHECK (opt_in_status IN ('unknown', 'opted_in', 'opted_out'));

-- Broadcast audience lookups only ever ask "who has opted out?".
CREATE INDEX IF NOT EXISTS idx_contacts_opted_out
  ON contacts (user_id)
  WHERE opt_in_status = 'opted_out';

CREATE TABLE IF NOT EXISTS contact_consent_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('unknown', 'opted_in', 'opted_out')),
  source      TEXT NOT NULL,
  note        TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  changed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_consent_events_contact
  ON contact_consent_events (contact_id, created_at DESC);

ALTER TABLE contact_consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read consent history of visible contacts" ON contact_consent_events;

-- Anyone who can see the contact (owner, or a member of its tenant) can read
-- its history. Writes happen only on the server (service role).
CREATE POLICY "Read consent history of visible contacts" ON contact_consent_events
  FOR SELECT
  USING (contact_id IN (SELECT id FROM contacts));
