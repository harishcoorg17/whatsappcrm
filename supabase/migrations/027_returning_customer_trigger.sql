-- Allow flows to start when a returning customer (known to the tenant's
-- backend, usually with a booking) messages again.
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_trigger_type_check;
ALTER TABLE flows
  ADD CONSTRAINT flows_trigger_type_check
  CHECK (trigger_type IN ('keyword', 'first_inbound_message', 'returning_customer', 'manual'));
