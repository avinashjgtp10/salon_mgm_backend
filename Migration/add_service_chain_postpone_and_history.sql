-- Service Chain: postponed steps, automatic retry bookkeeping and a per-step execution history.
--
--   service_chain_messages.status                 gains 'POSTPONED' (the client has an upcoming appointment for the step's
--                                                 service, so the message waits instead of being sent or skipped)
--   service_chain_messages.postponed_appointment_id  the appointment the step is waiting on
--   service_chain_messages.recheck_at             set to NOW()+24h when that appointment was cancelled: all checks re-run then
--   service_chain_messages.attempt_count          temporary WhatsApp failures retried so far (max 3)
--   service_chain_messages.next_retry_at          when the next automatic retry is due
--   service_chain_message_events                  append-only audit trail: every state change of every step
--
-- Requires create_service_chains.sql, add_service_chain_substeps.sql and add_service_chain_status_and_rules.sql first.
-- Per project policy this file is NOT auto-run; apply it by hand BEFORE the backend deploy.

BEGIN;

ALTER TABLE service_chain_messages DROP CONSTRAINT IF EXISTS service_chain_messages_status_check;
ALTER TABLE service_chain_messages
  ADD CONSTRAINT service_chain_messages_status_check
  CHECK (status IN ('SCHEDULED','POSTPONED','SENDING','SENT','DELIVERED','READ','FAILED','SKIPPED','CANCELLED'));

ALTER TABLE service_chain_messages
  ADD COLUMN IF NOT EXISTS postponed_appointment_id UUID,
  ADD COLUMN IF NOT EXISTS recheck_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count            INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at            TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_service_chain_msgs_postponed
  ON service_chain_messages (status, recheck_at) WHERE status = 'POSTPONED';

CREATE TABLE IF NOT EXISTS service_chain_message_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id       UUID NOT NULL,
  message_id     UUID NOT NULL REFERENCES service_chain_messages(id) ON DELETE CASCADE,
  enrolment_id   UUID NOT NULL,
  event          TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  reason         TEXT,
  appointment_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_chain_events_msg ON service_chain_message_events (message_id, created_at);

COMMIT;
