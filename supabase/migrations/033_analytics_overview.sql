-- ============================================================
-- 033_analytics_overview.sql
-- One read-only function behind the Analytics page: conversation volume, first
-- response times, SLA compliance, chats waiting for a reply, and per-agent
-- workload for one tenant over the last N days.
--
-- SECURITY INVOKER (the default): row level security still applies, so a
-- caller only ever aggregates conversations and messages they can already see
-- (the tenant's owner, or a member of the tenant).
--
-- Definitions
--   first response   customer's first message -> the first AGENT message after
--                    it (bot messages such as away replies do not count).
--   SLA met          first response within p_sla_minutes.
--   waiting now      open conversations whose latest message is the customer's.
--   days are UTC calendar days.
--
-- Idempotent: safe to run more than once.
-- ============================================================

CREATE OR REPLACE FUNCTION analytics_overview(
  p_tenant_id   UUID,
  p_days        INT DEFAULT 7,
  p_sla_minutes INT DEFAULT 15
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH params AS (
    SELECT GREATEST(1, LEAST(COALESCE(p_days, 7), 90))          AS days,
           GREATEST(1, LEAST(COALESCE(p_sla_minutes, 15), 1440)) AS sla
  ),
  convs AS (
    SELECT c.id, c.assigned_agent_id, c.status
    FROM conversations c, params p
    WHERE c.tenant_id = p_tenant_id
      AND c.created_at >= NOW() - make_interval(days => p.days)
  ),
  msgs AS (
    SELECT m.sender_type, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    CROSS JOIN params p
    WHERE c.tenant_id = p_tenant_id
      AND m.created_at >= NOW() - make_interval(days => p.days)
  ),
  first_resp AS (
    SELECT c.id AS conversation_id,
           c.assigned_agent_id,
           fi.at AS first_in,
           (SELECT MIN(m2.created_at)
              FROM messages m2
             WHERE m2.conversation_id = c.id
               AND m2.sender_type = 'agent'
               AND m2.created_at > fi.at) AS first_reply
    FROM convs c
    CROSS JOIN LATERAL (
      SELECT MIN(m.created_at) AS at
        FROM messages m
       WHERE m.conversation_id = c.id AND m.sender_type = 'customer'
    ) fi
    WHERE fi.at IS NOT NULL
  ),
  resp AS (
    SELECT conversation_id,
           assigned_agent_id,
           EXTRACT(EPOCH FROM (first_reply - first_in)) / 60.0 AS minutes
    FROM first_resp
    WHERE first_reply IS NOT NULL
  ),
  waiting AS (
    SELECT c.id AS conversation_id, lm.created_at AS since
    FROM conversations c
    CROSS JOIN LATERAL (
      SELECT m.sender_type, m.created_at
        FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
    ) lm
    WHERE c.tenant_id = p_tenant_id
      AND c.status <> 'closed'
      AND lm.sender_type = 'customer'
  ),
  day_series AS (
    SELECT d::date AS day
    FROM params p,
         generate_series(
           (NOW() AT TIME ZONE 'UTC')::date - (p.days - 1),
           (NOW() AT TIME ZONE 'UTC')::date,
           INTERVAL '1 day'
         ) AS d
  ),
  daily AS (
    SELECT s.day,
           COUNT(m.*) FILTER (WHERE m.sender_type = 'customer')              AS inbound,
           COUNT(m.*) FILTER (WHERE m.sender_type IN ('agent', 'bot'))       AS outbound
    FROM day_series s
    LEFT JOIN msgs m ON (m.created_at AT TIME ZONE 'UTC')::date = s.day
    GROUP BY s.day
  ),
  agent_stats AS (
    SELECT c.assigned_agent_id AS agent_id,
           COUNT(*)                                          AS assigned,
           COUNT(*) FILTER (WHERE c.status = 'closed')       AS closed,
           ROUND(AVG(r.minutes)::numeric, 1)                 AS avg_first_response_minutes
    FROM convs c
    LEFT JOIN resp r ON r.conversation_id = c.id
    WHERE c.assigned_agent_id IS NOT NULL
    GROUP BY c.assigned_agent_id
  )
  SELECT jsonb_build_object(
    'days', (SELECT days FROM params),
    'slaMinutes', (SELECT sla FROM params),
    'conversations', (SELECT COUNT(*) FROM convs),
    'inboundMessages', (SELECT COUNT(*) FROM msgs WHERE sender_type = 'customer'),
    'outboundMessages', (SELECT COUNT(*) FROM msgs WHERE sender_type IN ('agent', 'bot')),
    'respondedConversations', (SELECT COUNT(*) FROM resp),
    'unansweredConversations', (SELECT COUNT(*) FROM first_resp WHERE first_reply IS NULL),
    'avgFirstResponseMinutes',
      (SELECT ROUND(AVG(minutes)::numeric, 1) FROM resp),
    'medianFirstResponseMinutes',
      (SELECT ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes))::numeric, 1) FROM resp),
    'slaMetPercent',
      (SELECT CASE WHEN COUNT(*) = 0 THEN NULL
                   ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE minutes <= (SELECT sla FROM params)) / COUNT(*), 1)
              END
         FROM resp),
    'waitingBreaches',
      (SELECT COUNT(*) FROM waiting
        WHERE NOW() - since > make_interval(mins => (SELECT sla FROM params))),
    'waitingNow',
      COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'conversationId', w.conversation_id,
                   'waitingMinutes', ROUND(EXTRACT(EPOCH FROM (NOW() - w.since)) / 60.0)::int
                 )
                 ORDER BY w.since ASC)
          FROM (SELECT * FROM waiting ORDER BY since ASC LIMIT 10) w
      ), '[]'::jsonb),
    'daily',
      COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object('day', d.day, 'inbound', d.inbound, 'outbound', d.outbound)
                 ORDER BY d.day)
          FROM daily d
      ), '[]'::jsonb),
    'agents',
      COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'agentId', a.agent_id,
                   'assigned', a.assigned,
                   'closed', a.closed,
                   'avgFirstResponseMinutes', a.avg_first_response_minutes
                 )
                 ORDER BY a.assigned DESC)
          FROM agent_stats a
      ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION analytics_overview(UUID, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_overview(UUID, INT, INT) TO authenticated;
