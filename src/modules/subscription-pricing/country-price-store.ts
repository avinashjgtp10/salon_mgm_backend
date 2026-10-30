import pool from "../../config/database";
import logger from "../../config/logger";

// Storage for Super Admin's country-wise plan prices (Migration/create_country_plan_prices.sql). Same approach as billing-schema.ts:
// outside production the tables are created once on first use; in production they only come from the reviewed migration file, and until
// it is applied every country is priced exactly as before (INR price x exchange rate). Imports nothing from pricing.service so that
// file can use it.

const STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS country_plan_prices (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id      UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
        country_code VARCHAR(2) NOT NULL,
        currency     VARCHAR(3) NOT NULL,
        price        NUMERIC(14,2) NOT NULL CHECK (price > 0),
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT country_plan_prices_not_india CHECK (country_code <> 'IN'),
        UNIQUE (plan_id, country_code)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_country_plan_prices_country ON country_plan_prices (country_code) WHERE is_active`,
    `CREATE TABLE IF NOT EXISTS country_plan_razorpay_plans (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        country_price_id UUID NOT NULL REFERENCES country_plan_prices(id) ON DELETE CASCADE,
        account_key      VARCHAR(40) NOT NULL,
        mode             VARCHAR(7)  NOT NULL,
        currency         VARCHAR(3)  NOT NULL,
        amount           NUMERIC(14,2) NOT NULL,
        razorpay_plan_id VARCHAR(64) NOT NULL,
        synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (country_price_id, account_key)
    )`,
];

let ready: Promise<boolean> | null = null;

const mayApply = () => process.env.NODE_ENV !== "production" || process.env.AUTO_APPLY_BILLING_SCHEMA === "true";

export function countryPricingReady(): Promise<boolean> {
    if (!ready) {
        ready = (async () => {
            try {
                if (!mayApply()) {
                    const { rows } = await pool.query(
                        `SELECT (to_regclass('country_plan_prices') IS NOT NULL) AND (to_regclass('country_plan_razorpay_plans') IS NOT NULL) AS present`
                    );
                    if (!rows[0]?.present) logger.warn("Country plan price tables are not applied on this database; countries use converted INR prices");
                    return Boolean(rows[0]?.present);
                }
                for (const sql of STATEMENTS) await pool.query(sql);
                return true;
            } catch (err: any) {
                logger.warn("Country plan price tables could not be applied; countries use converted INR prices", { error: err?.message });
                return false;
            }
        })();
    }
    return ready;
}

export interface CountryOverride { currency: string; price: number }

/** The active Super Admin prices for one country, by subscription_plans.id. Empty when none are set or the tables don't exist yet. */
export async function loadOverridesForCountry(country: string | null | undefined): Promise<Map<string, CountryOverride>> {
    const out = new Map<string, CountryOverride>();
    const code = (country ?? "").trim().toUpperCase();
    if (!code || code === "IN" || !(await countryPricingReady())) return out;
    const { rows } = await pool.query(
        `SELECT plan_id, currency, price FROM country_plan_prices WHERE country_code = $1 AND is_active = TRUE`, [code]
    );
    for (const r of rows) out.set(r.plan_id as string, { currency: r.currency as string, price: Number(r.price) });
    return out;
}

/** True when any country price (active or switched off) exists for this plan in this currency; used to keep such currencies out of the held-FX-price lookup. */
export async function hasCountryPriceInCurrency(planId: string, currency: string): Promise<boolean> {
    if (!(await countryPricingReady())) return false;
    const { rows } = await pool.query(`SELECT 1 FROM country_plan_prices WHERE plan_id = $1 AND currency = $2 LIMIT 1`, [planId, currency]);
    return rows.length > 0;
}
