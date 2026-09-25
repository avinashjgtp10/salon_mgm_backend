-- Removes the "payroll" featureKey from the Advance tier's feature_keys
-- catalog (salon_plan_definitions.feature_keys), added by
-- add_feature_key_to_salon_plans.sql. This is what PlanFeatureGuard
-- featureKey="payroll" / hasFeature("payroll") gated on the frontend — both
-- gates are being removed along with the Payroll page/route, so the catalog
-- key is now unused.
--
-- Also strips the "Payroll" display-name string from the Advance tier's
-- customer-facing "features" array (the Pricing Plans marketing copy) —
-- same tier, added in create_salon_plans_system_tables.sql.
--
-- JUDGMENT CALL — flagged, not silently resolved: this changes what
-- hasFeature("payroll") returns for every salon currently on the Advance
-- tier (or with a salon_plan_customizations.feature_overrides["payroll"]
-- override). Since the Payroll UI/API no longer exists, hasFeature("payroll")
-- becoming false everywhere is harmless in itself — but if any other code
-- path outside the deleted Payroll module still branches on this exact key
-- in the future, or if there's a product reason to keep the catalog string
-- around for historical/billing display purposes, this migration should be
-- held back for confirmation before running. No salon_plan_customizations
-- rows are touched here (their feature_overrides is per-salon JSONB and not
-- modified by this migration).
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE salon_plan_definitions
SET feature_keys = feature_keys - 'payroll'
WHERE tier = 'advance';

UPDATE salon_plan_definitions
SET features = (
  SELECT jsonb_agg(elem)
  FROM jsonb_array_elements(features) AS elem
  WHERE elem <> '"Payroll"'::jsonb
)
WHERE tier = 'advance';

COMMIT;
