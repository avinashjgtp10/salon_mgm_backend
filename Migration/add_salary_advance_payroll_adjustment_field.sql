-- Allows "salary_advance" as an adjustable field in payroll_adjustments.
-- Per project policy this file is created but NOT auto-run; apply by hand.
BEGIN;
ALTER TABLE payroll_adjustments DROP CONSTRAINT IF EXISTS payroll_adjustments_field_check;
ALTER TABLE payroll_adjustments ADD CONSTRAINT payroll_adjustments_field_check
    CHECK (field IN ('commission', 'bonus', 'tips', 'deduction', 'other_earning', 'salary', 'salary_advance'));
COMMIT;
