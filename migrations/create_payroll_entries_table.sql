-- Payroll Entries table
-- One row per staff member per payroll period (weekly/bi-weekly/monthly/custom).
-- Net pay and pending amount are derived (base+commission+tips+bonus-salary_advance-deductions,
-- and net_pay-paid_amount) rather than stored, so they never drift from the source amounts.

CREATE TYPE payroll_period_type AS ENUM ('weekly', 'biweekly', 'monthly', 'custom');

CREATE TABLE IF NOT EXISTS payroll_entries (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id         UUID          NOT NULL,
    staff_id         UUID          NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    period_type      payroll_period_type NOT NULL,
    period_start     DATE          NOT NULL,
    period_end       DATE          NOT NULL,
    base_salary      NUMERIC(12,2) NOT NULL DEFAULT 0,
    commission       NUMERIC(12,2) NOT NULL DEFAULT 0,
    tips             NUMERIC(12,2) NOT NULL DEFAULT 0,
    bonus            NUMERIC(12,2) NOT NULL DEFAULT 0,
    salary_advance   NUMERIC(12,2) NOT NULL DEFAULT 0,
    deductions       NUMERIC(12,2) NOT NULL DEFAULT 0,
    paid_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_method   TEXT,
    payment_date     DATE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (staff_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_salon_id ON payroll_entries(salon_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_staff_id ON payroll_entries(staff_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_period   ON payroll_entries(period_start, period_end);
