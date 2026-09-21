-- Adds a "tiered_target" commission rule type: a monthly sales target per
-- staff member with two rates — one below target (stored in the existing
-- `rate` column) and one at/above target (new `rate_after_target` column).
-- Reuses the existing condition_target/condition_metric columns for the
-- target amount, exactly like "milestone" rules already do.
--
-- Nullable, no default — existing percentage/fixed/milestone rows are
-- completely untouched.
ALTER TABLE commission_rules
  ADD COLUMN IF NOT EXISTS rate_after_target NUMERIC;

ALTER TABLE commission_rules
  DROP CONSTRAINT IF EXISTS commission_rules_type_check;

ALTER TABLE commission_rules
  ADD CONSTRAINT commission_rules_type_check
  CHECK (type = ANY (ARRAY['percentage'::text, 'fixed'::text, 'milestone'::text, 'tiered_target'::text]));
