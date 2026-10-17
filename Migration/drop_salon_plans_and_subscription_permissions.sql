-- Removes the Super Admin "Plans Management" + "Subscription Permissions"
-- features and the plan-tier gating built on them.
--
-- RUN ORDER: deploy the backend + frontend that no longer reference these
-- tables FIRST, then run this. Running it while the old code is still live
-- breaks every plan-gated route and the salon purge (clearSalonData).
--
-- NOT touched on purpose: `subscriptions`, `subscription_plans`,
-- `subscription_payments`, `billing_*` (the paywall / Razorpay checkout that
-- stays), and `client_requirement_req_no_seq` (separate sequence).
--
-- Destructive and not reversible without a backup. Take one first. Dev, QA
-- and prod share an RDS host (separate databases) — run per database.
-- Written to be re-runnable (IF EXISTS everywhere).

BEGIN;

-- Dependents first: payments -> invoices/definitions; customizations,
-- prices and invoices -> definitions. No CASCADE, so an unexpected foreign
-- key from some other table makes this fail loudly instead of silently
-- dropping that constraint.
DROP TABLE IF EXISTS salon_plan_payments;
DROP TABLE IF EXISTS salon_plan_invoice_counters;
DROP TABLE IF EXISTS salon_plan_invoices;
DROP TABLE IF EXISTS salon_plan_customizations;
DROP TABLE IF EXISTS salon_plan_prices;
DROP TABLE IF EXISTS salon_plan_definitions;

-- Only the removed plan-payments Razorpay webhook wrote to this.
DROP TABLE IF EXISTS razorpay_webhook_events;

-- Invoice numbering for the removed salon_plan_invoices.
DROP SEQUENCE IF EXISTS salon_plan_invoice_no_seq;

-- Audit trail of the removed Subscription Permissions / grant / apply /
-- remove actions.
DROP TABLE IF EXISTS subscription_permission_audit_log;

-- Per-salon permission maps written by the removed Subscription Permissions
-- page; nothing reads this key any more.
DELETE FROM salon_settings WHERE key = 'subscription_permissions';

COMMIT;
