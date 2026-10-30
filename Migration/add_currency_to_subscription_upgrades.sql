-- Plan upgrades charged in the customer's own currency (e.g. USD) instead of INR.
-- Every amount stored on an upgrade row (new_plan_charge, credit_applied, subtotal, total, ...) is in `currency`. INR rows (all existing ones)
-- keep the default and behave exactly as before. fx_rate = units of `currency` per 1 INR used for the conversion.
-- Prerequisite: Migration/add_country_billing_columns.sql (currency columns on subscriptions / payments / invoices) and
-- Migration/add_subscription_upgrades.sql. Additive and safe to re-run. Until applied, upgrades keep being priced and charged in INR.

ALTER TABLE subscription_upgrades
  ADD COLUMN IF NOT EXISTS currency     VARCHAR(3)    NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS fx_rate      NUMERIC(18,8),
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(2);
