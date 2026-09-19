-- Feature: a percentage ("Discount Balance") membership plan can now run on
-- one of TWO mutually exclusive benefit models, chosen per plan:
--
--   'discount_balance' — today's behaviour. The plan hands out its % until a
--                        predefined monetary pool (discount_balance) is spent,
--                        decremented bill by bill, then stops.
--   'validity'         — the % applies to every eligible bill for as long as
--                        the membership is unexpired. Nothing is consumed and
--                        there is no pool at all.
--
-- The two can never both be active on one plan: benefit_type is a single
-- column, and the app hides/ignores discount_balance entirely for 'validity'.
--
-- Rollout is deliberately inert: the column defaults to 'discount_balance',
-- so every plan that exists today — and every membership already sold — keeps
-- behaving exactly as it does now. Only a plan explicitly re-saved as
-- 'validity' takes the new path.
--
-- client_memberships gets its own copy rather than joining to the plan: that
-- table already snapshots pricing_type / applies_to / category_ids at purchase
-- time on purpose, so that editing (or deleting) the catalog plan later can
-- never retroactively change the terms of a membership someone already paid
-- for. The benefit model has to follow the same rule.

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS benefit_type VARCHAR(20) NOT NULL DEFAULT 'discount_balance';

ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS benefit_type VARCHAR(20) NOT NULL DEFAULT 'discount_balance';

-- Guard rails: only the two known models, so a typo in a payload can't create
-- a third, silently-unhandled kind of plan. NOT VALID would let existing rows
-- skip the check, but every existing row is the default, so a plain
-- constraint is safe here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_benefit_type_chk') THEN
    ALTER TABLE memberships
      ADD CONSTRAINT memberships_benefit_type_chk
      CHECK (benefit_type IN ('discount_balance', 'validity'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_memberships_benefit_type_chk') THEN
    ALTER TABLE client_memberships
      ADD CONSTRAINT client_memberships_benefit_type_chk
      CHECK (benefit_type IN ('discount_balance', 'validity'));
  END IF;
END $$;

-- Sanity check after running:
--   SELECT benefit_type, pricing_type, COUNT(*) FROM memberships GROUP BY 1, 2;
-- Every pre-existing row should read 'discount_balance'.
