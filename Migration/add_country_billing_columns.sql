-- Country-based subscription pricing: what each subscription, payment and invoice was actually charged, and in which currency.
-- The same statements are applied automatically (once, lazily) by src/modules/subscription-pricing/billing-schema.ts, so this file
-- is only needed if the database user cannot alter tables at runtime. Per project policy it is created but NOT auto-run; apply it
-- by hand against each environment. Safe to re-run. Every default reproduces the old INR-only behaviour, so existing Indian
-- subscriptions, payments and invoices are unchanged.

BEGIN;

-- What the customer was quoted and charged when the subscription was started (the original purchase price and currency).
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS country_code      VARCHAR(2),      -- ISO country the price was worked out for
    ADD COLUMN IF NOT EXISTS pricing_currency  VARCHAR(3),      -- currency the price was SHOWN in (the country's currency)
    ADD COLUMN IF NOT EXISTS charged_currency  VARCHAR(3),      -- currency Razorpay charges (INR unless that currency is enabled)
    ADD COLUMN IF NOT EXISTS charged_amount    NUMERIC(14,2),   -- per-cycle amount charged, tax included
    ADD COLUMN IF NOT EXISTS charged_tax       NUMERIC(14,2),   -- tax inside that amount
    ADD COLUMN IF NOT EXISTS base_price_inr    NUMERIC(14,2),   -- the INR plan price (before GST) it was derived from
    ADD COLUMN IF NOT EXISTS display_amount    NUMERIC(14,2),   -- the amount shown to the customer in pricing_currency
    ADD COLUMN IF NOT EXISTS fx_rate           NUMERIC(18,8),   -- exchange rate used (1 for INR)
    ADD COLUMN IF NOT EXISTS pricing_razorpay_plan_id VARCHAR(64); -- Razorpay plan the subscription was created on

-- The real currency of each payment and invoice (Razorpay reports it on every charge).
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR';

-- Razorpay plan IDs for non-INR charges (and the held prices) are in razorpay_plan_registry, created by
-- Migration/add_razorpay_plan_registry.sql (apply that file after this one).

COMMIT;
