ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid', 'partial', 'refunded'));

CREATE INDEX IF NOT EXISTS idx_appointments_payment_status ON appointments (payment_status);
