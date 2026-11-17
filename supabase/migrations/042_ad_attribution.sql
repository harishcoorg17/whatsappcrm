-- ============================================================
-- 042_ad_attribution.sql
-- Click-to-WhatsApp ad attribution. Meta puts a `referral` object on the first
-- inbound message of a chat that started from an ad; the webhook stores it on
-- the conversation (first touch wins). analytics_ad_sources() then reports
-- chats, replies and deals per ad.
--
-- analytics_ad_sources: SECURITY INVOKER, so RLS still limits rows to what the
-- caller can see. Replied = an agent (person) answered; bot / away messages do
-- not count. Deals are those linked to the ad's conversations.
--
-- Idempotent: safe to run more than once.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ad_source_id    TEXT,
  ADD COLUMN IF NOT EXISTS ad_source_type  TEXT,
  ADD COLUMN IF NOT EXISTS ad_source_url   TEXT,
  ADD COLUMN IF NOT EXISTS ad_headline     TEXT,
  ADD COLUMN IF NOT EXISTS ad_body         TEXT,
  ADD COLUMN IF NOT EXISTS ad_ctwa_clid    TEXT,
  ADD COLUMN IF NOT EXISTS ad_media_url    TEXT,
  ADD COLUMN IF NOT EXISTS ad_referred_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_ad_source
  ON conversations (tenant_id, ad_source_id, created_at DESC)
  WHERE ad_source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION analytics_ad_sources(
  p_tenant_id UUID,
  p_days      INT DEFAULT 7
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH params AS (
    SELECT GREATEST(1, LEAST(COALESCE(p_days, 7), 90)) AS days
  ),
  ad_convs AS (
    SELECT c.id, c.ad_source_id, c.ad_headline, c.ad_source_type,
           c.ad_media_url, c.ad_source_url, c.created_at
    FROM conversations c, params p
    WHERE c.tenant_id = p_tenant_id
      AND c.ad_source_id IS NOT NULL
      AND COALESCE(c.ad_referred_at, c.created_at) >= NOW() - make_interval(days => p.days)
  ),
  per_conv AS (
    SELECT a.*,
           EXISTS (SELECT 1 FROM messages m
                    WHERE m.conversation_id = a.id AND m.sender_type = 'agent') AS replied,
           (SELECT COUNT(*) FROM deals d WHERE d.conversation_id = a.id)        AS deals,
           (SELECT COUNT(*) FROM deals d
             WHERE d.conversation_id = a.id AND d.status = 'won')                AS won_deals
    FROM ad_convs a
  ),
  per_ad AS (
    SELECT ad_source_id,
           (ARRAY_AGG(ad_headline ORDER BY created_at DESC)
              FILTER (WHERE ad_headline IS NOT NULL))[1] AS headline,
           MAX(ad_source_type)  AS source_type,
           MAX(ad_media_url)    AS media_url,
           MAX(ad_source_url)   AS source_url,
           COUNT(*)             AS chats,
           COUNT(*) FILTER (WHERE replied) AS replies,
           SUM(deals)           AS deals,
           SUM(won_deals)       AS won_deals
    FROM per_conv
    GROUP BY ad_source_id
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'sourceId', ad_source_id,
             'headline', headline,
             'sourceType', source_type,
             'mediaUrl', media_url,
             'sourceUrl', source_url,
             'chats', chats,
             'replies', replies,
             'deals', deals,
             'wonDeals', won_deals
           ) ORDER BY chats DESC, ad_source_id), '[]'::jsonb)
  FROM per_ad;
$$;

REVOKE ALL ON FUNCTION analytics_ad_sources(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_ad_sources(UUID, INT) TO authenticated;
