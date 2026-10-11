-- Per-cycle pricing for the 3 fixed plan tiers (3 tiers x 3 billing cycles = 9
-- prices). Prices are the listed amount EXCLUDING GST — 18% GST is added on
-- top at checkout/invoice time (see GST_RATE_PERCENT in
-- modules/plan-payments/plan-payments.service.ts).
--
-- salon_plan_definitions.price is kept as the ANNUAL price so every existing
-- reader of that column (landing page, Billing page, SubscriptionWall,
-- invoices) keeps working unchanged; it is re-synced from the annual row
-- below and by the backend whenever the annual price is edited.
--
-- Run by hand. Safe to re-run: the table is IF NOT EXISTS and the seed does
-- nothing for rows that already exist (so a re-run never overwrites prices an
-- admin has since edited).

CREATE TABLE IF NOT EXISTS salon_plan_prices (
  tier           VARCHAR(20)   NOT NULL REFERENCES salon_plan_definitions(tier),
  billing_cycle  VARCHAR(20)   NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
  price          NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  updated_by     UUID REFERENCES users(id),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tier, billing_cycle)
);

-- Final pricing. NB: the "Growth" plan is stored as tier 'pro'.
INSERT INTO salon_plan_prices (tier, billing_cycle, price) VALUES
  ('basic',   'monthly',     799),
  ('basic',   'quarterly',  2099),
  ('basic',   'annual',     7999),
  ('advance', 'monthly',     999),
  ('advance', 'quarterly',  2699),
  ('advance', 'annual',     9999),
  ('pro',     'monthly',    1299),
  ('pro',     'quarterly',  3699),
  ('pro',     'annual',    14999)
ON CONFLICT (tier, billing_cycle) DO NOTHING;

-- Keep the legacy single price column equal to the annual price.
UPDATE salon_plan_definitions d
   SET price = p.price, updated_at = NOW()
  FROM salon_plan_prices p
 WHERE p.tier = d.tier
   AND p.billing_cycle = 'annual'
   AND d.price IS DISTINCT FROM p.price;
