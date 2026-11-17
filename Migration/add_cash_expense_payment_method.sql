-- Cash Management: every expense now records HOW it was paid (Cash, UPI, Card, Bank transfer, Other).
-- Existing expenses were all treated as cash, so they default to 'cash' and nothing about past counters changes.
-- Only 'cash' expenses reduce a counter's cash balance; the others are recorded for the expense list and reports.
-- (The backend also adds this column on startup, so running this by hand is optional and safe to repeat.)
ALTER TABLE cash_management_expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash';
ALTER TABLE cash_management_expenses DROP CONSTRAINT IF EXISTS chk_cash_expense_payment_method;
ALTER TABLE cash_management_expenses ADD CONSTRAINT chk_cash_expense_payment_method
  CHECK (payment_method IN ('cash', 'upi', 'card', 'bank_transfer', 'other'));
