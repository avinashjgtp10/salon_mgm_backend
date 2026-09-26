-- Restores the "payroll" featureKey to the Advance tier's feature_keys
-- catalog (salon_plan_definitions.feature_keys) — reverse of
-- remove_payroll_feature_key.sql, now that the Payroll module/page/route are
-- being rebuilt. This is what PlanFeatureGuard featureKey="payroll" /
-- hasFeature("payroll") gates on the frontend and requirePlanFeature("payroll")
-- gates on the backend.
--
-- Also restores the "Payroll" display-name string to the Advance tier's
-- customer-facing "features" array (Pricing Plans marketing copy).
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE salon_plan_definitions
SET feature_keys = feature_keys || '[{"key": "payroll", "label": "Payroll"}]'::jsonb
WHERE tier = 'advance'
  AND NOT (feature_keys @> '[{"key": "payroll"}]'::jsonb);

UPDATE salon_plan_definitions
SET features = features || '["Payroll"]'::jsonb
WHERE tier = 'advance'
  AND NOT (features @> '["Payroll"]'::jsonb);

COMMIT;
