-- Paytm machine for Card / UPI + exactly-once recording and recovery.
-- Requires Migration/create_pos_payments_tables.sql and
-- Migration/add_payment_terminal_serial_number.sql to have run first.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment BEFORE deploying the matching backend, as
-- one transaction:   psql "<connection>" -1 -f Migration/pos_payments_card_upi_recovery.sql
--
-- Safe to re-run: the backfills below run only in the same run that first
-- adds checkout_settled_at, so a second run changes no rows.

-- ── pos_payment_requests ────────────────────────────────────────────────
-- payment_mode: what the machine is asked to accept — 'CARD' (Card) or
--   'QR' (UPI). NULL = machine default (requests created before this change).
-- provider_terminal_id / provider_environment: snapshot of the TID and
--   Live/Test mode the Sale was sent with, so status checks and cancels keep
--   addressing the same machine and server even if Settings change mid-payment.
-- record_attempts / last_record_error: automatic retries of saving a payment
--   Paytm has confirmed (server restart, database error…).
-- checkout_settled_at: set once the post-payment step is finished — checkout
--   done for a fully paid bill, or nothing to do for a partial payment. Only
--   ever meaningful on SUCCESS requests; NULL there = still to do.
DO $$
DECLARE
  first_run boolean := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'pos_payment_requests' AND column_name = 'checkout_settled_at'
  );
BEGIN
  ALTER TABLE pos_payment_requests ADD COLUMN IF NOT EXISTS payment_mode         VARCHAR(10);
  ALTER TABLE pos_payment_requests ADD COLUMN IF NOT EXISTS provider_terminal_id VARCHAR(100);
  ALTER TABLE pos_payment_requests ADD COLUMN IF NOT EXISTS provider_environment VARCHAR(20);
  ALTER TABLE pos_payment_requests ADD COLUMN IF NOT EXISTS record_attempts      INT NOT NULL DEFAULT 0;
  ALTER TABLE pos_payment_requests ADD COLUMN IF NOT EXISTS last_record_error    TEXT;
  ALTER TABLE pos_payment_requests ADD COLUMN IF NOT EXISTS checkout_settled_at  TIMESTAMPTZ;

  IF first_run THEN
    -- Snapshots for requests created before this migration.
    UPDATE pos_payment_requests r
       SET provider_terminal_id = t.provider_terminal_id
      FROM payment_terminals t
     WHERE r.terminal_id = t.id AND r.provider_terminal_id IS NULL;

    UPDATE pos_payment_requests r
       SET provider_environment = c.environment
      FROM payment_provider_configs c
     WHERE c.salon_id = r.salon_id AND c.provider = r.provider AND r.provider_environment IS NULL;

    -- Only payments already paid AND saved by the previous code, which ran
    -- its checkout inline at that time. Open requests (PENDING/PROCESSING)
    -- and confirmed-but-unsaved ones stay NULL, so the new recovery checks
    -- them out once they're paid and saved. Failed/cancelled/expired ones
    -- never need a checkout and are never looked at, so they stay NULL too.
    UPDATE pos_payment_requests
       SET checkout_settled_at = COALESCE(completed_at, NOW())
     WHERE status = 'SUCCESS' AND payment_id IS NOT NULL;

    -- Confirmed by the provider but never saved by the PREVIOUS code. That
    -- code told staff to enter these payments by hand, so they may already
    -- be recorded — the new automatic recovery must never save them again.
    -- Marking retries as used up keeps them where they were: with a person,
    -- blocking further payments only while flagged for review.
    UPDATE pos_payment_requests
       SET record_attempts = 10, -- MAX_RECORD_ATTEMPTS in pos-payments.types.ts
           last_record_error = 'Recorded before automatic recovery existed — reconcile by hand; never saved automatically.'
     WHERE status = 'SUCCESS' AND payment_id IS NULL;
  END IF;
END $$;

-- Recovery sweep: confirmed by the provider but not yet saved.
CREATE INDEX IF NOT EXISTS idx_pos_payment_requests_unrecorded
  ON pos_payment_requests(created_at)
  WHERE status = 'SUCCESS' AND payment_id IS NULL;

-- ── payments ────────────────────────────────────────────────────────────
-- Links a payment row to the machine transaction it records. The unique
-- index is the exactly-once guarantee: one confirmed transaction can never
-- produce two payment rows, however many times recording is retried.
-- The link backfill only fills rows still missing it, so re-running it is a no-op.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pos_payment_request_id UUID;

UPDATE payments p
   SET pos_payment_request_id = r.id
  FROM pos_payment_requests r
 WHERE r.payment_id = p.id AND p.pos_payment_request_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_pos_payment_request_id_key
  ON payments(pos_payment_request_id)
  WHERE pos_payment_request_id IS NOT NULL;
