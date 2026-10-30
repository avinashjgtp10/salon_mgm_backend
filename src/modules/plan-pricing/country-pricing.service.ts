import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { currencyForCountry } from "../subscription-pricing/country-currency";
import { countryPricingReady } from "../subscription-pricing/country-price-store";
import { CYCLES, TIERS, enabledChargeCurrenciesNow, exponentOf, round2, type BasePlan, type Cycle, type Tier } from "../subscription-pricing/pricing.service";
import { resolveRazorpayPlan } from "../subscription-pricing/razorpay-plans";
import { getActiveRazorpayAccount } from "../subscription-pricing/razorpay-account";
import { billingSchemaReady } from "../subscription-pricing/billing-schema";

// Super Admin's country-wise subscription prices: for one country, an independent Basic / Advance / Growth price per billing cycle, in that
// country's currency, plus the Razorpay plan each one is mapped to. Saving stores the prices first, then creates (or reuses) the Razorpay
// plans for every cycle Razorpay can bill; a cycle that cannot be synced is reported with the reason and still saved, and checkout creates
// the plan on demand. INR / India is never touched here: it stays on the main Plans pricing.

const MAX_AMOUNT = 100_000_000;
const TIER_NAMES: Record<Tier, string> = { basic: "SalonOx Basic", advance: "SalonOx Advance", growth: "SalonOx Growth" };
const planSlug = (tier: Tier, cycle: Cycle) => `salonox-${tier}-${cycle}`;

export type CellStatus = "none" | "synced" | "pending" | "not_eligible" | "failed";

interface Cell {
    /** The INR plan row this price belongs to; null when that cycle isn't offered in INR yet (so no country price can be set). */
    plan_id: string | null;
    /** The main (India) price before GST, for reference. */
    base_inr: number | null;
    /** Saved price in the country's currency; null = not set (the country uses the converted INR price). */
    price: number | null;
    razorpay_plan_id: string | null;
    status: CellStatus;
    message: string | null;
}

async function resolveCountry(input: unknown) {
    const found = currencyForCountry(typeof input === "string" ? input : null);
    if (!found) throw new AppError(400, "Unknown country", "VALIDATION_ERROR");
    if (found.country === "IN") throw new AppError(400, "India is priced in INR on the main Plans pricing; country pricing is for other countries.", "VALIDATION_ERROR");
    if (!(await countryPricingReady())) {
        throw new AppError(503, "Country pricing isn't available on this server yet (database migration create_country_plan_prices.sql is missing).", "BILLING_SCHEMA_MISSING");
    }
    return found;
}

/** Can Razorpay Subscriptions bill this currency right now? */
async function eligibility(currency: string): Promise<{ ok: boolean; reason: string | null }> {
    if (exponentOf(currency) !== 2) {
        return { ok: false, reason: `${currency} can't be billed directly by Razorpay Subscriptions, so customers here are billed in INR.` };
    }
    const enabled = await enabledChargeCurrenciesNow();
    if (!enabled.has("*") && !enabled.has(currency)) {
        return { ok: false, reason: `${currency} isn't enabled under Payment Gateway > subscription currencies, so customers here are billed in INR.` };
    }
    return { ok: true, reason: null };
}

async function loadBase() {
    const { rows } = await pool.query(
        `SELECT id, slug, name, price, is_active, razorpay_plan_id, razorpay_amount FROM subscription_plans WHERE slug LIKE 'salonox-%'`
    );
    return new Map(rows.map((r) => [r.slug as string, r]));
}

async function view(country: string, currency: string, results: Map<string, { status: CellStatus; message: string | null }> = new Map()) {
    const [base, elig, account] = await Promise.all([loadBase(), eligibility(currency), getActiveRazorpayAccount()]);
    const { rows: saved } = await pool.query(
        `SELECT p.id, p.plan_id, p.price, p.is_active, m.razorpay_plan_id, m.amount AS mapped_amount
         FROM country_plan_prices p
         LEFT JOIN country_plan_razorpay_plans m ON m.country_price_id = p.id AND m.account_key = $2
         WHERE p.country_code = $1`,
        [country, account.key]
    );
    const byPlan = new Map(saved.map((r) => [r.plan_id as string, r]));

    const tiers = TIERS.map((tier) => {
        const prices = {} as Record<Cycle, Cell>;
        for (const cycle of CYCLES) {
            const row = base.get(planSlug(tier, cycle));
            const usable = Boolean(row?.is_active);
            const mine = row ? byPlan.get(row.id as string) : undefined;
            const price = mine?.is_active ? Number(mine.price) : null;
            const mapped = price !== null && mine?.razorpay_plan_id && Number(mine.mapped_amount) === price ? (mine.razorpay_plan_id as string) : null;
            const result = results.get(`${tier}:${cycle}`);
            let status: CellStatus = "none";
            let message: string | null = null;
            if (price !== null) {
                if (result) ({ status, message } = result);
                else if (mapped) status = "synced";
                else if (!elig.ok) { status = "not_eligible"; message = elig.reason; }
                else status = "pending";
            }
            prices[cycle] = {
                plan_id: usable ? (row!.id as string) : null,
                base_inr: usable ? Number(row!.price) : null,
                price, razorpay_plan_id: mapped, status, message,
            };
        }
        return { slug: tier, name: TIER_NAMES[tier], prices };
    });
    return {
        country, currency, decimals: exponentOf(currency),
        razorpay_eligible: elig.ok, razorpay_note: elig.reason,
        razorpay_mode: account.mode,
        tiers,
    };
}

/** Creates (or reuses) the Razorpay plan for each given saved price on the active account and records the mapping. */
async function syncCells(country: string, currency: string, wanted: { tier: Tier; cycle: Cycle }[]) {
    const results = new Map<string, { status: CellStatus; message: string | null }>();
    if (!wanted.length) return results;
    const elig = await eligibility(currency);
    const base = await loadBase();
    const account = await getActiveRazorpayAccount();
    const canRegister = await billingSchemaReady();
    for (const { tier, cycle } of wanted) {
        const key = `${tier}:${cycle}`;
        if (!elig.ok) { results.set(key, { status: "not_eligible", message: elig.reason }); continue; }
        const row = base.get(planSlug(tier, cycle));
        const { rows } = await pool.query(`SELECT id, price FROM country_plan_prices WHERE plan_id = $1 AND country_code = $2 AND is_active = TRUE`, [row?.id, country]);
        const saved = rows[0];
        if (!row || !saved) continue;
        const price = Number(saved.price);
        const plan: BasePlan = {
            id: row.id, slug: row.slug, tier, cycle, name: row.name, price: Number(row.price),
            razorpay_plan_id: row.razorpay_plan_id ?? null, razorpay_amount: row.razorpay_amount == null ? null : Number(row.razorpay_amount),
        };
        try {
            if (!canRegister) throw new AppError(503, "Plan registry is not available on this server yet (database migration missing).", "BILLING_SCHEMA_MISSING");
            const impliedRate = plan.price > 0 ? Number((price / plan.price).toFixed(8)) : 1;
            const rzpId = await resolveRazorpayPlan(plan, currency, price, impliedRate);
            await pool.query(
                `INSERT INTO country_plan_razorpay_plans (country_price_id, account_key, mode, currency, amount, razorpay_plan_id)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (country_price_id, account_key)
                 DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency, razorpay_plan_id = EXCLUDED.razorpay_plan_id, mode = EXCLUDED.mode, synced_at = NOW()`,
                [saved.id, account.key, account.mode, currency, price, rzpId]
            );
            results.set(key, { status: "synced", message: null });
        } catch (err: any) {
            logger.warn("Country price could not be synced with Razorpay", { country, currency, tier, cycle, error: err?.message });
            results.set(key, { status: "failed", message: err?.message ?? "Razorpay could not create the plan" });
        }
    }
    return results;
}

export const countryPricingService = {
    /** Every country that has saved prices, with each price and how many are mapped to a Razorpay plan on the active account. */
    async list() {
        if (!(await countryPricingReady())) return [];
        const account = await getActiveRazorpayAccount();
        const { rows } = await pool.query(
            `SELECT c.country_code, c.currency, p.slug, c.price, m.razorpay_plan_id, m.amount AS mapped_amount
             FROM country_plan_prices c
             JOIN subscription_plans p ON p.id = c.plan_id
             LEFT JOIN country_plan_razorpay_plans m ON m.country_price_id = c.id AND m.account_key = $1
             WHERE c.is_active = TRUE
             ORDER BY c.country_code`,
            [account.key]
        );
        const byCountry = new Map<string, { country: string; currency: string; prices: Record<string, number>; total: number; synced: number }>();
        for (const r of rows) {
            const m = /^salonox-(basic|advance|growth)-(monthly|quarterly|yearly)$/.exec(r.slug as string);
            if (!m) continue;
            const code = r.country_code as string;
            const e = byCountry.get(code) ?? { country: code, currency: r.currency as string, prices: {}, total: 0, synced: 0 };
            e.prices[`${m[1]}:${m[2]}`] = Number(r.price);
            e.total += 1;
            if (r.razorpay_plan_id && Number(r.mapped_amount) === Number(r.price)) e.synced += 1;
            byCountry.set(code, e);
        }
        return [...byCountry.values()];
    },

    async get(countryInput: unknown) {
        const { country, currency } = await resolveCountry(countryInput);
        return view(country, currency);
    },

    /** `prices` is tier -> cycle -> amount (in the country's currency) or null to switch that price off. Only the cycles sent are changed. */
    async set(countryInput: unknown, prices: unknown) {
        const { country, currency } = await resolveCountry(countryInput);
        if (!prices || typeof prices !== "object") throw new AppError(400, "prices must be an object of tier -> cycle -> amount", "VALIDATION_ERROR");
        const input = prices as Record<string, Record<string, unknown> | undefined>;
        const base = await loadBase();
        const decimals = exponentOf(currency) === 0 ? 0 : 2;

        const changes: { tier: Tier; cycle: Cycle; planId: string; price: number | null }[] = [];
        for (const tier of TIERS) {
            const t = input[tier];
            if (!t || typeof t !== "object") continue;
            for (const cycle of CYCLES) {
                if (!(cycle in t)) continue;
                const v = t[cycle];
                const row = base.get(planSlug(tier, cycle));
                if (v === null || v === undefined || v === "") {
                    if (row) changes.push({ tier, cycle, planId: row.id as string, price: null });
                    continue;
                }
                const n = Number(v);
                if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) {
                    throw new AppError(400, `${TIER_NAMES[tier]} ${cycle} amount must be a number greater than 0`, "VALIDATION_ERROR");
                }
                if (!row || !row.is_active) {
                    throw new AppError(400, `${TIER_NAMES[tier]} isn't offered ${cycle} in India yet; set its INR price first, then add the country price.`, "VALIDATION_ERROR");
                }
                changes.push({ tier, cycle, planId: row.id as string, price: decimals === 0 ? Math.round(n) : round2(n) });
            }
        }

        const toSync: { tier: Tier; cycle: Cycle }[] = [];
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const c of changes) {
                if (c.price === null) {
                    await client.query(`UPDATE country_plan_prices SET is_active = FALSE, updated_at = NOW() WHERE plan_id = $1 AND country_code = $2`, [c.planId, country]);
                    continue;
                }
                await client.query(
                    `INSERT INTO country_plan_prices (plan_id, country_code, currency, price, is_active)
                     VALUES ($1, $2, $3, $4, TRUE)
                     ON CONFLICT (plan_id, country_code)
                     DO UPDATE SET currency = EXCLUDED.currency, price = EXCLUDED.price, is_active = TRUE, updated_at = NOW()`,
                    [c.planId, country, currency, c.price]
                );
                toSync.push({ tier: c.tier, cycle: c.cycle });
            }
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        return view(country, currency, await syncCells(country, currency, toSync));
    },

    /** Re-checks every saved price of the country against Razorpay (creating whatever plan is missing) without changing any price. */
    async sync(countryInput: unknown) {
        const { country, currency } = await resolveCountry(countryInput);
        const { rows } = await pool.query(
            `SELECT p.slug FROM country_plan_prices c JOIN subscription_plans p ON p.id = c.plan_id WHERE c.country_code = $1 AND c.is_active = TRUE`, [country]
        );
        const wanted: { tier: Tier; cycle: Cycle }[] = [];
        for (const r of rows) {
            const m = /^salonox-(basic|advance|growth)-(monthly|quarterly|yearly)$/.exec(r.slug as string);
            if (m) wanted.push({ tier: m[1] as Tier, cycle: m[2] as Cycle });
        }
        return view(country, currency, await syncCells(country, currency, wanted));
    },
};
