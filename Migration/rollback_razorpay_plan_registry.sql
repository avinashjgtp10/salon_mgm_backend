-- Rollback for Migration/add_razorpay_plan_registry.sql.
--
-- What it removes: the plan registry and the consent / replacement columns. What it does NOT touch: subscription_plans (incl.
-- razorpay_plan_id / razorpay_amount), subscriptions rows, payments and invoices. After a rollback, deploy the previous backend build
-- (it reads subscription_plans.razorpay_plan_id only) and make sure the keys in use match the account that owns those IDs.
--
-- Data that is lost: the registry rows (plan IDs created or adopted per account) and any recorded INR-consent / replacement links. The
-- registry holds no money or subscription state, only the mapping "plan + account -> Razorpay plan ID", so it can be rebuilt by running
-- checkouts again (plans are re-created or re-adopted on demand).
--
-- Run only after the application no longer uses these objects (stop or roll back the backend first).

BEGIN;

DROP INDEX IF EXISTS idx_razorpay_plan_registry_lookup;
DROP TABLE IF EXISTS razorpay_plan_registry;

ALTER TABLE subscriptions
    DROP COLUMN IF EXISTS replaces_subscription_id,
    DROP COLUMN IF EXISTS currency_consent_amount,
    DROP COLUMN IF EXISTS currency_consent_requested,
    DROP COLUMN IF EXISTS currency_consent_at;

COMMIT;
