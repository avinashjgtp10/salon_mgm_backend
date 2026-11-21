-- All Expense: every expense is now Paid or Unpaid.
-- Only PAID expenses count as cash outflow (Total Expenses and Net Cash Flow); unpaid ones are listed and totalled separately.
-- Existing expenses were all real payments, so they default to 'paid' and no past figure changes.
-- (The backend also adds this column on startup, so running it by hand is optional and safe to repeat.)
-- Per project policy apply by hand to dev, QA, then prod.
ALTER TABLE cash_management_expenses ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'paid';
ALTER TABLE cash_management_expenses DROP CONSTRAINT IF EXISTS chk_cash_expense_status;
ALTER TABLE cash_management_expenses ADD CONSTRAINT chk_cash_expense_status CHECK (status IN ('paid', 'unpaid'));
