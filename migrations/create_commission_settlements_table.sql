-- Commission Settlements table
-- Audit trail of every commission settlement transaction (full or partial),
-- separate from commission_earned (which tracks per-sale commission rows).

CREATE TYPE commission_settlement_status AS ENUM ('partial', 'paid');

CREATE TABLE IF NOT EXISTS commission_settlements (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id           UUID          NOT NULL,
    staff_id           UUID          NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    settled_amount     NUMERIC(12,2) NOT NULL,
    remaining_balance  NUMERIC(12,2) NOT NULL,
    status             commission_settlement_status NOT NULL,
    settled_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    settled_by         UUID,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_settlements_staff_id  ON commission_settlements(staff_id);
CREATE INDEX IF NOT EXISTS idx_commission_settlements_salon_id  ON commission_settlements(salon_id);
CREATE INDEX IF NOT EXISTS idx_commission_settlements_settled_at ON commission_settlements(settled_at);
