-- Razorpay plan IDs per Razorpay ACCOUNT, plus consent and plan-replacement records.
--
-- Why: subscription_plans.razorpay_plan_id is a single column, but a Razorpay plan ID only exists on ONE Razorpay account (TEST and LIVE
-- are different accounts). Switching keys on the same database made the column hold a mix of IDs and the old code overwrote it, which
-- would have broken LIVE checkout after testing. This table keeps one row per (plan, account, currency, amount); an account's rows can only
-- be read or written by a server using that account's keys (account_key is a one-way fingerprint of the key id, never the key).
--
-- Safety: ADDITIVE ONLY. Nothing is dropped, altered or rewritten:
--   * subscription_plans.razorpay_plan_id / razorpay_amount are NOT touched. Existing subscriptions keep pointing at their plan through
--     subscriptions.plan_id and at Razorpay through razorpay_subscription_id; renewals come from Razorpay's own schedule.
--   * No data is copied in. Existing IDs are adopted at runtime, one at a time, only when the active Razorpay account recognises the ID
--     with the same amount, currency and period (a read-only check), so an ID from another account is never trusted.
-- The same statements are applied lazily by src/modules/subscription-pricing/billing-schema.ts; this file is for applying by hand
-- (dev, then QA, then prod). Safe to re-run. Rollback: Migration/rollback_razorpay_plan_registry.sql.
-- Prerequisite: Migration/add_country_billing_columns.sql (country / currency columns).

BEGIN;

-- Consent to be billed in INR when the customer's own currency is not enabled, and the link from a replacement subscription to the one it
-- replaces (a plan change on a non-INR subscription starts a NEW subscription at the end of the current period).
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS currency_consent_at        TIMESTAMPTZ,     -- when the customer agreed to INR billing
    ADD COLUMN IF NOT EXISTS currency_consent_requested VARCHAR(3),      -- the currency they had asked for (e.g. USD)
    ADD COLUMN IF NOT EXISTS currency_consent_amount    NUMERIC(14,2),   -- the INR amount they agreed to
    ADD COLUMN IF NOT EXISTS replaces_subscription_id   UUID REFERENCES subscriptions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS razorpay_plan_registry (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id          UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    account_key      VARCHAR(40) NOT NULL,                       -- "<mode>:<10 hex of SHA-256(key id)>"
    mode             VARCHAR(7)  NOT NULL CHECK (mode IN ('live', 'test', 'unknown')),
    currency         VARCHAR(3)  NOT NULL,
    amount           NUMERIC(14,2) NOT NULL,                     -- charged per cycle, tax included, in `currency` (also the held price)
    base_price_inr   NUMERIC(14,2),
    fx_rate          NUMERIC(18,8),
    razorpay_plan_id VARCHAR(64) NOT NULL,
    period           VARCHAR(8)  NOT NULL,                       -- monthly | yearly (a quarter is monthly x 3)
    interval_count   INTEGER     NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, account_key, currency, amount),
    UNIQUE (account_key, razorpay_plan_id)
);
CREATE INDEX IF NOT EXISTS idx_razorpay_plan_registry_lookup
    ON razorpay_plan_registry (plan_id, account_key, currency, created_at DESC);

COMMIT;
