-- Who changed a paid bill's payment method (Cash -> UPI etc.), when, and from what.
-- Additive and safe to re-run. Per project policy NOT auto-run; apply by hand dev -> QA -> prod.
-- Not required for the feature to work: the change itself succeeds without this table, it just isn't recorded.

CREATE TABLE IF NOT EXISTS payment_method_changes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id       UUID        NOT NULL,
  appointment_id UUID        NOT NULL,
  from_method    VARCHAR(60) NOT NULL,
  to_method      VARCHAR(60) NOT NULL,
  changed_by     UUID        NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_method_changes_appt ON payment_method_changes (appointment_id, created_at DESC);
