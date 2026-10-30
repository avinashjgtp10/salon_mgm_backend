-- Country-wise subscription pricing (Super Admin > Plans > Country pricing).
-- Purely additive: INR prices in subscription_plans and every existing subscription are untouched. A country with no row here keeps
-- being priced by converting the INR price at the live exchange rate, exactly as before.

CREATE TABLE IF NOT EXISTS country_plan_prices (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id      UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    country_code VARCHAR(2) NOT NULL,
    currency     VARCHAR(3) NOT NULL,
    price        NUMERIC(14,2) NOT NULL CHECK (price > 0),   -- per billing cycle, in `currency`, no tax added
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,              -- FALSE = switched off (the row is kept so history is never lost)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT country_plan_prices_not_india CHECK (country_code <> 'IN'),
    UNIQUE (plan_id, country_code)
);

CREATE INDEX IF NOT EXISTS idx_country_plan_prices_country ON country_plan_prices (country_code) WHERE is_active;

-- The Razorpay plan each country price is mapped to, per Razorpay account (TEST and LIVE never share rows).
CREATE TABLE IF NOT EXISTS country_plan_razorpay_plans (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_price_id UUID NOT NULL REFERENCES country_plan_prices(id) ON DELETE CASCADE,
    account_key      VARCHAR(40) NOT NULL,
    mode             VARCHAR(7)  NOT NULL,
    currency         VARCHAR(3)  NOT NULL,
    amount           NUMERIC(14,2) NOT NULL,                 -- the amount that plan charges, to detect a stale mapping after a price change
    razorpay_plan_id VARCHAR(64) NOT NULL,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (country_price_id, account_key)
);
