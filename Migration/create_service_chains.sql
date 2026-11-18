-- Service Chain: automated WhatsApp follow-up journeys.
--
-- A salon owner defines a chain once (starting service + ordered steps, each step
-- = "N days after the purchase", a service, and an APPROVED wa_templates row).
-- When a client pays for the starting service they are enrolled and one message
-- per step is scheduled; a poller sends them with no staff action.
--
--   service_chains            the journey definition
--   service_chain_steps       ordered steps (day offset + template + variable map)
--   service_chain_enrolments  one row per (chain, bill line) that started a journey;
--                             the unique key is what makes the enrolment sweep
--                             idempotent
--   service_chain_messages    one row per (enrolment, step) with its own status
--
-- References to salons / clients cascade so deleting a salon or client never
-- trips over these tables; references to services / templates are SET NULL so
-- deleting one leaves the chain inert (steps then fail with a clear reason)
-- instead of blocking the delete.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment (dev/QA/prod) in that order, BEFORE the backend deploy.

BEGIN;

CREATE TABLE IF NOT EXISTS service_chains (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id             UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  starting_service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
  -- Salon-local wall-clock time every step of this chain is sent at.
  send_time            TIME NOT NULL DEFAULT '10:00',
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_chains_salon ON service_chains (salon_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS service_chain_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id      UUID NOT NULL REFERENCES service_chains(id) ON DELETE CASCADE,
  step_order    INT  NOT NULL,
  -- The service this step's message is about; also what the skip rule watches.
  service_id    UUID REFERENCES services(id) ON DELETE SET NULL,
  -- Days AFTER the purchase date (after-only; 0 = purchase day).
  day_offset    INT  NOT NULL CHECK (day_offset BETWEEN 0 AND 365),
  template_id   UUID REFERENCES wa_templates(id) ON DELETE SET NULL,
  -- { "1": "client_name", "2": "salon_name", ... } : template {{n}} -> field key.
  variable_map  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, step_order)
);

CREATE TABLE IF NOT EXISTS service_chain_enrolments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  chain_id                UUID NOT NULL REFERENCES service_chains(id) ON DELETE CASCADE,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_appointment_id   UUID NOT NULL,
  -- The appointment service line's own id (appointments.services[].id).
  source_line_id          TEXT NOT NULL,
  purchased_at            TIMESTAMPTZ NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','cancelled','replaced','superseded')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, source_appointment_id, source_line_id)
);
-- One live journey per client per chain.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_chain_enrol_active
  ON service_chain_enrolments (chain_id, client_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_service_chain_enrol_salon ON service_chain_enrolments (salon_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_chain_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id       UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  enrolment_id   UUID NOT NULL REFERENCES service_chain_enrolments(id) ON DELETE CASCADE,
  step_id        UUID NOT NULL REFERENCES service_chain_steps(id) ON DELETE CASCADE,
  scheduled_at   TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'SCHEDULED'
                 CHECK (status IN ('SCHEDULED','SENDING','SENT','DELIVERED','READ','FAILED','SKIPPED','CANCELLED')),
  skip_reason    TEXT,
  wamid          TEXT,
  error_code     TEXT,
  error_message  TEXT,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enrolment_id, step_id)
);
CREATE INDEX IF NOT EXISTS idx_service_chain_msgs_due ON service_chain_messages (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_service_chain_msgs_wamid ON service_chain_messages (wamid) WHERE wamid IS NOT NULL;

COMMIT;
