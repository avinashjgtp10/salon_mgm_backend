-- Rebuilds the Payroll module's data model from scratch (data-driven payroll
-- rebuild — see plan). payroll_entries / payroll_salary_advances already
-- exist live in the DB (left in place by the prior removal pass) and are
-- NOT recreated here — this migration only ADDs columns to payroll_entries
-- and creates the two new audit/payment tables the rebuilt module needs.
--
-- payroll_adjustments mirrors the commission_settlements/tip_settlements
-- shape already used elsewhere in this codebase as the "audit trail against
-- a source-of-truth total" pattern (see commissionCalculation.service.ts's
-- commission_settlements) — append-only, one row per manual adjustment made
-- before a period is paid.
--
-- payroll_payments is the duplicate-payment guard: existence of a row for a
-- payroll_entry_id (enforced by the UNIQUE constraint below) means that
-- period has already been paid — a second Pay Salary click is rejected at
-- the DB level, not just in application logic.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

DO $$ BEGIN
    CREATE TYPE payroll_entry_status AS ENUM ('draft', 'pending', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- other_earning is added alongside status/locked_at (both new) because the
-- old payroll_entries had no manual-adjustment-only "Other Earnings" field
-- (see AdjustPayrollBody's field enum) — every other adjustable column
-- already existed on the live table.
ALTER TABLE payroll_entries
    ADD COLUMN IF NOT EXISTS status         payroll_entry_status NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS locked_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS other_earning  NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS payroll_adjustments (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id         UUID          NOT NULL,
    staff_id         UUID          NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    payroll_entry_id UUID          NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
    field            TEXT          NOT NULL CHECK (field IN ('commission', 'bonus', 'tips', 'deduction', 'other_earning', 'salary')),
    original_value   NUMERIC(12,2) NOT NULL DEFAULT 0,
    adjusted_value   NUMERIC(12,2) NOT NULL DEFAULT 0,
    reason           TEXT          NOT NULL,
    adjusted_by      UUID,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_entry ON payroll_adjustments(payroll_entry_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_staff ON payroll_adjustments(salon_id, staff_id);

CREATE TABLE IF NOT EXISTS payroll_payments (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id         UUID          NOT NULL,
    staff_id         UUID          NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    payroll_entry_id UUID          NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
    amount           NUMERIC(12,2) NOT NULL,
    payment_method   TEXT          NOT NULL,
    payment_reference TEXT,
    paid_by          UUID,
    paid_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    receipt_sent_at  TIMESTAMPTZ,
    UNIQUE (payroll_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_payments_staff ON payroll_payments(salon_id, staff_id);

COMMIT;
