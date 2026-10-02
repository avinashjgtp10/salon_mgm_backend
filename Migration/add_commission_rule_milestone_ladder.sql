-- Adds a "milestone_ladder" commission rule type: several monthly-revenue steps
-- in one rule, each paying a one-time flat reward that STACKS with the earlier
-- ones (e.g. 500->50, 1000->100, 2000->200, 3000->300, 5000->1000 = 1650 total).
--
-- Steps live in a nullable JSONB column: [{"target": 500, "reward": 50}, ...].
-- `rate` holds the sum of all rewards (set by the API), so it stays populated.
--
-- Nullable, no default — existing percentage/fixed/milestone/tiered_target rows
-- are completely untouched. A ladder and any other rule type are kept mutually
-- exclusive per staff + source by the API, not by the database.
ALTER TABLE commission_rules
  ADD COLUMN IF NOT EXISTS tiers JSONB;

ALTER TABLE commission_rules
  DROP CONSTRAINT IF EXISTS commission_rules_type_check;

ALTER TABLE commission_rules
  ADD CONSTRAINT commission_rules_type_check
  CHECK (type = ANY (ARRAY['percentage'::text, 'fixed'::text, 'milestone'::text, 'tiered_target'::text, 'milestone_ladder'::text]));
