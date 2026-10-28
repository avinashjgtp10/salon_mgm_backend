import pool from "../../config/database";
import logger from "../../config/logger";

// Country / currency details of a subscription and of each payment and invoice. The same statements are in
// Migration/add_country_billing_columns.sql (apply it by hand per environment). They are also applied once, lazily, the first
// time they are needed, so a database that hasn't had the migration yet keeps working; if the database user may not alter tables
// the app simply carries on with the original INR-only columns (billingSchemaReady() resolves false).
//
// Everything has a default that reproduces the old behaviour, so existing Indian subscriptions, payments and invoices are
// unchanged: currency 'INR', no country.

const STATEMENTS = [
    `ALTER TABLE subscriptions
        ADD COLUMN IF NOT EXISTS country_code      VARCHAR(2),
        ADD COLUMN IF NOT EXISTS pricing_currency  VARCHAR(3),
        ADD COLUMN IF NOT EXISTS charged_currency  VARCHAR(3),
        ADD COLUMN IF NOT EXISTS charged_amount    NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS charged_tax       NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS base_price_inr    NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS display_amount    NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS fx_rate           NUMERIC(18,8),
        ADD COLUMN IF NOT EXISTS pricing_razorpay_plan_id VARCHAR(64)`,
    `ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR'`,
    `ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR'`,
    // Consent to be billed in INR when the customer's own currency is not enabled, and the link from a replacement subscription to the one it
    // replaces (a plan change on a non-INR subscription starts a NEW subscription at the end of the current period).
    `ALTER TABLE subscriptions
        ADD COLUMN IF NOT EXISTS currency_consent_at        TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS currency_consent_requested VARCHAR(3),
        ADD COLUMN IF NOT EXISTS currency_consent_amount    NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS replaces_subscription_id   UUID REFERENCES subscriptions(id) ON DELETE SET NULL`,
    // Razorpay plan IDs, kept per Razorpay ACCOUNT (account_key, see razorpay-account.ts). TEST and LIVE (or any two accounts) therefore
    // never read or overwrite each other's plan IDs. One row per (plan, account, currency, amount); the amount is what is charged each
    // cycle, tax included, in that currency, and is also the held price for non-INR charges.
    `CREATE TABLE IF NOT EXISTS razorpay_plan_registry (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id          UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
        account_key      VARCHAR(40) NOT NULL,
        mode             VARCHAR(7)  NOT NULL CHECK (mode IN ('live', 'test', 'unknown')),
        currency         VARCHAR(3)  NOT NULL,
        amount           NUMERIC(14,2) NOT NULL,
        base_price_inr   NUMERIC(14,2),
        fx_rate          NUMERIC(18,8),
        razorpay_plan_id VARCHAR(64) NOT NULL,
        period           VARCHAR(8)  NOT NULL,
        interval_count   INTEGER     NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (plan_id, account_key, currency, amount),
        UNIQUE (account_key, razorpay_plan_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_razorpay_plan_registry_lookup ON razorpay_plan_registry (plan_id, account_key, currency, created_at DESC)`,
];

let ready: Promise<boolean> | null = null;

// Outside production the statements above are applied automatically, once. In PRODUCTION they are NOT: schema changes there go through the
// reviewed migration files (Migration/add_country_billing_columns.sql, Migration/add_razorpay_plan_registry.sql). The server only checks
// (read-only) that they were applied, and until they are it keeps working on the original INR-only columns. Set
// AUTO_APPLY_BILLING_SCHEMA=true to allow the automatic path in production too.
const mayApply = () => process.env.NODE_ENV !== "production" || process.env.AUTO_APPLY_BILLING_SCHEMA === "true";

async function schemaPresent(): Promise<boolean> {
    const { rows } = await pool.query(
        `SELECT (to_regclass('razorpay_plan_registry') IS NOT NULL) AS registry,
                (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'subscriptions'
                   AND column_name IN ('country_code', 'currency_consent_at', 'replaces_subscription_id')) AS sub_cols,
                (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema = current_schema()
                   AND table_name IN ('subscription_payments', 'subscription_invoices') AND column_name = 'currency') AS currency_cols`
    );
    const r = rows[0];
    return Boolean(r?.registry) && r.sub_cols === 3 && r.currency_cols === 2;
}

export function billingSchemaReady(): Promise<boolean> {
    if (!ready) {
        ready = (async () => {
            try {
                if (!mayApply()) {
                    const present = await schemaPresent();
                    if (!present) logger.warn("Country billing migrations are not applied on this database; continuing with INR-only billing records");
                    return present;
                }
                for (const sql of STATEMENTS) await pool.query(sql);
                return true;
            } catch (err: any) {
                logger.warn("Country billing columns could not be applied; continuing with INR-only billing records", { error: err?.message });
                return false;
            }
        })();
    }
    return ready;
}
