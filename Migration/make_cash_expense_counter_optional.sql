-- All Expense is now independent of the cash counter: a new expense is not tied to any counter,
-- so cash_management_expenses.cash_management_id must be allowed to be NULL.
-- Old expenses keep their counter id (and keep counting toward that counter's figures); nothing is changed or deleted.
-- (The backend also applies this on startup, so running it by hand is optional and safe to repeat.)
-- Per project policy apply by hand to dev, QA, then prod.
ALTER TABLE cash_management_expenses ALTER COLUMN cash_management_id DROP NOT NULL;
