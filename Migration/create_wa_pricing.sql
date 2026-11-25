-- WhatsApp per-message price list (Marketing > Policy, campaign cost estimate).
--
-- Meta has no pricing API: it publishes its rate cards as files on its public pricing page. The server reads those official
-- files on a schedule (src/modules/marketing/whatsapp/pricing) and keeps the latest good copy here, so the app never carries
-- prices of its own. Purely additive: no existing table or row is touched.
--
--   wa_pricing_rates    one row per (currency, Meta market): Marketing / Utility / Authentication / Authentication-International / Service
--   wa_pricing_markets  which Meta market each country is charged as (by the recipient's country calling code)
--   wa_pricing_tiers    Meta's monthly-volume tiers for Utility / Authentication (informational)
--   wa_pricing_sync     single row: when the data was last refreshed, and the last error if a refresh failed
--
-- Without this migration the Policy page shows "price list not set up yet" and nothing else breaks.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each environment (dev/QA/prod) in that
-- order, BEFORE deploying the backend that reads it. Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS wa_pricing_rates (
    currency           VARCHAR(3)    NOT NULL,
    market             VARCHAR(80)   NOT NULL,
    marketing          NUMERIC(14,6),
    utility            NUMERIC(14,6),
    authentication     NUMERIC(14,6),
    auth_international NUMERIC(14,6),               -- NULL = Meta lists "n/a" (the market has no separate rate)
    service            NUMERIC(14,6),
    effective_date     DATE,                         -- from the rate card's own title ("effective October 1, 2026")
    fetched_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (currency, market)
);

CREATE TABLE IF NOT EXISTS wa_pricing_markets (
    iso2      CHAR(2)      PRIMARY KEY,
    country   VARCHAR(80)  NOT NULL,
    dial_code VARCHAR(8)   NOT NULL,
    market    VARCHAR(80)  NOT NULL                  -- a market name in wa_pricing_rates; a country not in this table is charged as "Other"
);

CREATE TABLE IF NOT EXISTS wa_pricing_tiers (
    currency  VARCHAR(3)   NOT NULL,
    market    VARCHAR(80)  NOT NULL,
    category  VARCHAR(16)  NOT NULL,                 -- utility | authentication | authIntl
    tier_from BIGINT       NOT NULL,                 -- messages per month the tier starts at
    tier_to   BIGINT,                                -- NULL = open-ended last tier
    rate_type VARCHAR(24)  NOT NULL,
    rate      NUMERIC(14,6) NOT NULL,
    vs_list   NUMERIC(8,4) NOT NULL DEFAULT 0,       -- -0.05 = 5% below the list rate
    PRIMARY KEY (currency, market, category, tier_from)
);

CREATE TABLE IF NOT EXISTS wa_pricing_sync (
    id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_ok_at      TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    last_error      TEXT,
    effective_date  DATE,
    effective_text  TEXT
);
INSERT INTO wa_pricing_sync (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMIT;
