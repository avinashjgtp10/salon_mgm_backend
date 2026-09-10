-- Payment Machine (POS terminal) integration.
-- Adds: a per-salon atomic sequence for PAY-XXXXX references (mirrors
-- next_invoice_seq/next_purchase_seq), a terminal registry scoped to a
-- branch, a provider-credentials table, the pending/confirmed payment
-- request itself, and an append-only audit trail.
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment before using the pos-payments module.

ALTER TABLE salons ADD COLUMN IF NOT EXISTS next_payment_seq INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS payment_terminals (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id              UUID          NOT NULL REFERENCES salons(id),
  branch_id             UUID          REFERENCES branches(id),
  provider              VARCHAR(30)   NOT NULL,
  terminal_label        VARCHAR(100)  NOT NULL,
  -- Provider-issued device identifier (Paytm TID, Cashfree cf_terminal_id, etc).
  provider_terminal_id  VARCHAR(100),
  is_active             BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_terminals_salon  ON payment_terminals(salon_id);
CREATE INDEX IF NOT EXISTS idx_payment_terminals_branch ON payment_terminals(branch_id);

-- Credentials are stored PLAINTEXT (see `credentials` jsonb below) by explicit
-- product decision: this repo has no encryption-at-rest anywhere today (the
-- closest precedent, IntegrationsPage.tsx, also stores secrets as plaintext
-- JSON), and adding one would require a new master-key env var nobody with
-- deploy access has committed to setting. Revisit if that changes.
CREATE TABLE IF NOT EXISTS payment_provider_configs (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id          UUID          NOT NULL REFERENCES salons(id),
  provider          VARCHAR(30)   NOT NULL,
  environment       VARCHAR(20)   NOT NULL DEFAULT 'sandbox',
  merchant_id       VARCHAR(100),
  credentials       JSONB,
  is_enabled        BOOLEAN       NOT NULL DEFAULT FALSE,
  last_tested_at    TIMESTAMPTZ,
  last_test_result  VARCHAR(255),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_provider_configs_salon_provider_key UNIQUE (salon_id, provider)
);

CREATE TABLE IF NOT EXISTS pos_payment_requests (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                  UUID          NOT NULL REFERENCES salons(id),
  branch_id                 UUID          REFERENCES branches(id),
  appointment_id            UUID          REFERENCES appointments(id),
  client_id                 UUID          REFERENCES clients(id),
  sale_id                   UUID          REFERENCES sales(id),
  -- payments.id (the real PK), filled in once the provider confirms and the
  -- payload has been replayed into payments.service.ts's create().
  payment_id                UUID          REFERENCES payments(id),
  terminal_id               UUID          REFERENCES payment_terminals(id),
  payment_reference         VARCHAR(20)   NOT NULL,
  provider                  VARCHAR(30)   NOT NULL,
  provider_transaction_id   VARCHAR(100),
  amount                    NUMERIC(12,2) NOT NULL,
  currency                  VARCHAR(10)   NOT NULL DEFAULT 'INR',
  status                    VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  -- Insurance discriminator, not branching logic: everything today replays
  -- through payments.service.ts's create(), the only confirmed-live payment
  -- write path. If a second entry point ever turns out to be live too, this
  -- is what would let the confirm handler branch without a schema change.
  origin_flow               VARCHAR(30)   NOT NULL DEFAULT 'appointment_payment',
  -- The full CreatePaymentBody the frontend already built for this bill —
  -- replayed into payments.service.ts's create() once the provider confirms,
  -- so every existing side effect (tax/wallet/commission/receipts) fires
  -- exactly as it does for a Cash/Card/UPI payment today.
  payload                   JSONB         NOT NULL,
  provider_response         JSONB,
  needs_review              BOOLEAN       NOT NULL DEFAULT FALSE,
  review_reason             TEXT,
  created_by                UUID,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at              TIMESTAMPTZ,
  expires_at                TIMESTAMPTZ,
  CONSTRAINT pos_payment_requests_salon_reference_key UNIQUE (salon_id, payment_reference)
);
CREATE INDEX IF NOT EXISTS idx_pos_payment_requests_salon       ON pos_payment_requests(salon_id);
CREATE INDEX IF NOT EXISTS idx_pos_payment_requests_appointment ON pos_payment_requests(appointment_id);
CREATE INDEX IF NOT EXISTS idx_pos_payment_requests_status      ON pos_payment_requests(status);

CREATE TABLE IF NOT EXISTS pos_payment_events (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_payment_request_id  UUID        NOT NULL REFERENCES pos_payment_requests(id),
  event_type              VARCHAR(30) NOT NULL,
  from_status             VARCHAR(20),
  to_status               VARCHAR(20),
  raw_payload             JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_payment_events_request ON pos_payment_events(pos_payment_request_id);
