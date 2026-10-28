-- Which currencies customers may be CHARGED in for subscriptions (Super Admin: Plans > Payment Gateway).
-- Comma-separated ISO codes, e.g. "USD,AED", or "auto" (try every customer's own currency and let Razorpay accept/refuse it).
-- NULL = not set here, so the RAZORPAY_SUBSCRIPTION_CURRENCIES environment variable (then the built-in default) applies.
-- Prerequisite: Migration/create_platform_razorpay_settings.sql. Safe to re-run.

ALTER TABLE platform_razorpay_settings ADD COLUMN IF NOT EXISTS subscription_currencies VARCHAR(200);
