-- Settings > Payment Methods: let a salon switch the built-in Cash / Card / UPI
-- methods off, the same way it can already switch its own methods off.
--
-- A row means "this salon has switched this built-in method OFF". No row means
-- it is on, so every existing salon keeps all three with no backfill. The names
-- themselves stay fixed (the cash drawer, payment machines and reports key off
-- them) and nothing already recorded is touched: history keeps the method it was
-- paid with. Switching a method off only stops it being offered for NEW payments.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment (dev/QA/prod) in that order, BEFORE deploying the
-- backend. Until it is applied the app behaves as if nothing is switched off.

BEGIN;

CREATE TABLE IF NOT EXISTS salon_disabled_payment_methods (
  salon_id    UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  method_key  VARCHAR(20) NOT NULL CHECK (method_key IN ('cash', 'card', 'upi')),
  disabled_by UUID NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (salon_id, method_key)
);

COMMIT;
