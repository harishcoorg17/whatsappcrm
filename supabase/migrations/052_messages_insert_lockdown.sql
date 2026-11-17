-- Closes a hole in messages row-level security.
--
-- 001_initial_schema.sql created "Service role can insert messages" with
-- WITH CHECK (true) and no TO clause, so it applied to every role: any
-- signed-in user (and even a signed-out visitor holding the public anon key)
-- could insert a message into ANY tenant's conversation.
--
-- The policy was never needed. The service role bypasses row-level security
-- (the webhook, flows, automations, AI agent and consent writers all use it),
-- and the inbox send route inserts with the user's own session, which is
-- covered by:
--   * "Users can view own messages"      (FOR ALL, owner of the conversation)
--   * "Members manage tenant messages"   (FOR ALL, tenant member, from 030)
-- FOR ALL policies apply their USING expression to inserts as well, so those
-- two already limit inserts to conversations the caller owns or belongs to.
--
-- Dropping the permissive policy leaves exactly those two in force.

DROP POLICY IF EXISTS "Service role can insert messages" ON messages;

-- Check afterwards (expect no INSERT policy with with_check = 'true'):
--   SELECT policyname, cmd, roles, with_check
--   FROM pg_policies WHERE tablename = 'messages';
