-- Commission Rules Engine
-- NOT YET APPLIED — written per request but deliberately not run against the DB.
-- Run manually against salonoxdb_dev when ready.
--
-- Replaces the old staff_commission_settings / commission_slabs model (single rule
-- per staff+category) with a proper rules engine: named rules with a source, a type
-- (percentage / fixed / milestone), a scope (salon-wide / specific staff / role),
-- an optional threshold condition, a payout frequency, and a status.
-- commission_earned / commission_history (existing tables) are unaffected — they
-- still record what was actually paid out; this table defines the rules that
-- produce those records.
--
-- commission_rule_tiers below is currently unused by the rule-creation UI (an
-- earlier multi-tier milestone design was simplified to single-reward-plus-
-- condition) — left in place since it's harmless and cheap to keep for now.

CREATE TABLE IF NOT EXISTS commission_rules (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id          UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name              TEXT          NOT NULL,
  source            TEXT          NOT NULL
                      CHECK (source IN ('services', 'products', 'memberships', 'packages')),
  type              TEXT          NOT NULL
                      CHECK (type IN ('percentage', 'fixed', 'milestone')),
  rate              NUMERIC(10,2),                 -- percentage value or fixed ₹ amount; null for milestone
  milestone_metric  TEXT
                      CHECK (milestone_metric IN ('revenue', 'count')),
  milestone_period  TEXT          DEFAULT 'monthly'
                      CHECK (milestone_period IN ('daily', 'monthly')),
  frequency         TEXT          NOT NULL DEFAULT 'monthly'
                      CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'custom')),
  scope_type        TEXT          NOT NULL DEFAULT 'salon'
                      CHECK (scope_type IN ('salon', 'staff', 'role')),
  scope_id          TEXT,                          -- staff id or role name; null when scope_type = 'salon'
  -- Threshold gate, applies to ALL types (percentage/fixed only pay once this is met;
  -- milestone always requires it — the "They receive X when they generate Y based on Z" condition).
  condition_target  NUMERIC(12,2),
  condition_metric  TEXT
                      CHECK (condition_metric IN ('revenue', 'count')),
  status            TEXT          NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('active', 'draft', 'expired')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Safety net: if commission_rules already existed from an earlier run of this file
-- (before condition_target/condition_metric existed), CREATE TABLE IF NOT EXISTS above
-- is a no-op and these columns would otherwise never get added. Safe to run either way.
ALTER TABLE commission_rules ADD COLUMN IF NOT EXISTS condition_target NUMERIC(12,2);
ALTER TABLE commission_rules ADD COLUMN IF NOT EXISTS condition_metric TEXT
  CHECK (condition_metric IN ('revenue', 'count'));

CREATE INDEX IF NOT EXISTS idx_commission_rules_salon ON commission_rules (salon_id);
CREATE INDEX IF NOT EXISTS idx_commission_rules_scope ON commission_rules (scope_type, scope_id);

-- Milestone tiers — multiple reward levels per milestone-type rule
-- e.g. ₹20,000 → ₹2,000 bonus / ₹40,000 → ₹5,000 bonus / ₹60,000 → ₹8,000 bonus
CREATE TABLE IF NOT EXISTS commission_rule_tiers (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     UUID          NOT NULL REFERENCES commission_rules(id) ON DELETE CASCADE,
  target      NUMERIC(12,2) NOT NULL,
  reward      NUMERIC(10,2) NOT NULL,
  sort_order  INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_rule_tiers_rule ON commission_rule_tiers (rule_id);

-- Link commission_earned rows back to the new-engine rule/tier that produced them.
-- Needed so the calculation service can tell which milestone tiers have already
-- been awarded this period (without this, a crossed tier would be re-awarded on
-- every subsequent sale instead of once).
ALTER TABLE commission_earned ADD COLUMN IF NOT EXISTS rule_id UUID REFERENCES commission_rules(id) ON DELETE SET NULL;
ALTER TABLE commission_earned ADD COLUMN IF NOT EXISTS tier_id UUID REFERENCES commission_rule_tiers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_commission_earned_rule ON commission_earned (rule_id);
