CREATE TABLE IF NOT EXISTS payroll_salary_advances (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id             UUID          NOT NULL,
    staff_id             UUID          NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    amount               NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    advance_date         DATE          NOT NULL,
    payroll_period_start DATE          NOT NULL,
    payroll_period_end   DATE          NOT NULL,
    note                 TEXT,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_salary_advances_salon_period
    ON payroll_salary_advances(salon_id, payroll_period_start, payroll_period_end);
CREATE INDEX IF NOT EXISTS idx_payroll_salary_advances_staff
    ON payroll_salary_advances(staff_id);
CREATE INDEX IF NOT EXISTS idx_payroll_salary_advances_date
    ON payroll_salary_advances(advance_date);
