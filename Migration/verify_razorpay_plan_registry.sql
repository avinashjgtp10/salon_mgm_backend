-- Read-only checks to run after Migration/add_razorpay_plan_registry.sql (and after the first checkouts). Nothing here changes data.

-- 1. The objects exist (expect 4 columns on subscriptions and the table).
SELECT column_name FROM information_schema.columns
WHERE table_name = 'subscriptions'
  AND column_name IN ('currency_consent_at', 'currency_consent_requested', 'currency_consent_amount', 'replaces_subscription_id')
ORDER BY column_name;
SELECT to_regclass('razorpay_plan_registry') AS registry_table;

-- 2. The original plan columns are untouched (compare with a copy taken before the migration; the migration never writes them).
SELECT slug, razorpay_plan_id, razorpay_amount FROM subscription_plans WHERE slug LIKE 'salonox-%' ORDER BY slug;

-- 3. TEST and LIVE never share a row: each plan ID belongs to exactly one account_key (expect 0 rows).
SELECT razorpay_plan_id, COUNT(DISTINCT account_key) AS accounts
FROM razorpay_plan_registry GROUP BY razorpay_plan_id HAVING COUNT(DISTINCT account_key) > 1;

-- 4. Rows per account and mode (a LIVE account_key should start with 'live:'; test rows must never carry a live mode).
SELECT account_key, mode, currency, COUNT(*) AS plans FROM razorpay_plan_registry GROUP BY 1, 2, 3 ORDER BY 1, 3;

-- 5. Every registry row points at a real plan, and the mode agrees with the key prefix (expect 0 rows).
SELECT r.id FROM razorpay_plan_registry r LEFT JOIN subscription_plans p ON p.id = r.plan_id WHERE p.id IS NULL;
SELECT id, account_key, mode FROM razorpay_plan_registry WHERE split_part(account_key, ':', 1) <> mode;

-- 6. Existing subscriptions are intact: counts by status (compare before / after).
SELECT status, COUNT(*) FROM subscriptions GROUP BY status ORDER BY status;

-- 7. Consent records: every subscription billed in INR for a customer whose currency was different has a consent timestamp (expect 0 rows).
SELECT id, pricing_currency, charged_currency FROM subscriptions
WHERE pricing_currency IS NOT NULL AND charged_currency IS NOT NULL AND pricing_currency <> charged_currency AND currency_consent_at IS NULL
  AND created_at > NOW() - INTERVAL '30 days';
