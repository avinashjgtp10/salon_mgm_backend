import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { GST_PERCENT } from "../plan-pricing/plan-pricing.service";
import { currencyForCountry } from "./country-currency";
import { getInrRates, type RatesResult } from "./fx-rates";
import { billingSchemaReady } from "./billing-schema";
import { currentRazorpayAccount, getActiveRazorpayAccount, type RazorpayMode } from "./razorpay-account";
import { getRazorpayCredentials } from "../../config/razorpay";
import { hasCountryPriceInCurrency, loadOverridesForCountry, type CountryOverride } from "./country-price-store";

// THE server-side price calculation for subscription plans. Every screen (landing page, registration, Billing & Plans, the plan
// step, Super Admin) and Razorpay checkout read prices from here, and checkout never trusts an amount sent by the browser.
//
// Rules are the landing page's own, not a new system:
//  - Plan prices are kept in INR (Super Admin's Plans page). A country's price is that INR price x the live exchange rate
//    (same source as the landing page), shown with two decimals; INR stays in whole rupees. Where no rate is available the
//    price stays in INR.
//  - India: GST (18%) is added on top of the INR price. Other countries: "excl. applicable taxes" (no tax added to the shown price).
//
// What the customer is actually CHARGED is a separate, explicit decision (see chargeFor): Razorpay Subscriptions only bills
// currencies that are enabled on the merchant account, so a non-INR charge happens only for currencies listed in
// RAZORPAY_SUBSCRIPTION_CURRENCIES. Anything else is billed in INR, and the quote says so ("fallback"), with the exact INR amount.

export const TIERS = ["basic", "advance", "growth"] as const;
export const CYCLES = ["monthly", "quarterly", "yearly"] as const;
export type Tier = (typeof TIERS)[number];
export type Cycle = (typeof CYCLES)[number];

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Razorpay amounts are in the currency's smallest unit; only two-decimal currencies are handled for a non-INR charge, so the
// zero- and three-decimal ones are never charged directly (they fall back to INR with a clear reason).
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
export const exponentOf = (currency: string) => (ZERO_DECIMAL.has(currency) ? 0 : THREE_DECIMAL.has(currency) ? 3 : 2);

// Which currencies the server may CHARGE (a customer's own currency always comes from their country; this only decides whether it is billed in it).
//   RAZORPAY_SUBSCRIPTION_CURRENCIES=USD,AED  -> exactly those (plus INR). The safe choice for LIVE once Razorpay has confirmed them.
//   RAZORPAY_SUBSCRIPTION_CURRENCIES=auto     -> every customer's own currency is tried; Razorpay itself accepts or refuses it when the plan is
//                                                created, and a refusal turns into the INR offer (explicit consent), never a dead end.
//   not set                                   -> behaves like "auto" on TEST and LIVE (a Razorpay refusal becomes the INR offer).
//   RAZORPAY_SUBSCRIPTION_CURRENCIES=INR      -> INR only (switches country currencies off).
// A currency Razorpay has just refused is skipped for an hour so we don't ask again for every checkout.
const REFUSED_TTL_MS = 60 * 60 * 1000;
const refused = new Map<string, number>();
export function markCurrencyRefused(currency: string) { refused.set(currency, Date.now()); }
export function clearRefusedCurrencies() { refused.clear(); }
function isRefused(currency: string) {
    const at = refused.get(currency);
    if (at === undefined) return false;
    if (Date.now() - at > REFUSED_TTL_MS) { refused.delete(currency); return false; }
    return true;
}

/** The currencies chargeable right now: Super Admin's saved list (Plans > Payment Gateway) first, else the environment variable, for the active account. */
export async function enabledChargeCurrenciesNow(): Promise<Set<string>> {
    const [creds, account] = await Promise.all([getRazorpayCredentials(), getActiveRazorpayAccount()]);
    return enabledChargeCurrencies({ ...process.env, RAZORPAY_SUBSCRIPTION_CURRENCIES: creds.subscriptionCurrencies ?? "" }, account.mode);
}

export function enabledChargeCurrencies(env: NodeJS.ProcessEnv = process.env, _mode: RazorpayMode = currentRazorpayAccount(env).mode): Set<string> {
    const out = new Set<string>(["INR"]);
    const raw = (env.RAZORPAY_SUBSCRIPTION_CURRENCIES ?? "").trim();
    for (const part of raw.split(",")) {
        const c = part.trim().toUpperCase();
        if (c === "AUTO" || c === "*") out.add("*");
        else if (/^[A-Z]{3}$/.test(c)) out.add(c);
    }
    // Nothing configured: try the customer's own currency on TEST and LIVE alike. If Razorpay refuses it when the plan is created, the
    // customer is offered INR with explicit consent (markCurrencyRefused), so no per-currency setup is needed.
    if (!raw) out.add("*");
    return out;
}

/** Can this currency be charged right now? INR always; others only when enabled (or in auto mode) and not just refused by Razorpay. */
export const isChargeable = (enabled: Set<string>, currency: string) =>
    currency === "INR" || ((enabled.has("*") || enabled.has(currency)) && !isRefused(currency));

const lockDays = () => Math.max(0, Number(process.env.PRICING_FX_LOCK_DAYS ?? 30) || 0);

export interface BasePlan {
    id: string;
    slug: string;
    tier: Tier;
    cycle: Cycle;
    name: string;
    /** Price in INR, BEFORE GST (what Super Admin enters). */
    price: number;
    razorpay_plan_id: string | null;
    razorpay_amount: number | null;
}

export interface Breakdown {
    currency: string;
    subtotal: number;
    tax: number;
    tax_percent: number;
    total: number;
    /** What each renewal costs (the same as `total`: plans renew at the same price). */
    recurring_amount: number;
}

export interface LockedPrice { currency: string; amount: number; fx_rate: number; razorpay_plan_id: string | null }

export interface Quote {
    tier: Tier;
    cycle: Cycle;
    plan_name: string;
    country: string;
    /** The Indian (INR) price list: the original plan price. */
    base: Breakdown;
    /** The price as shown for this country (the landing page's number). */
    display: Breakdown & { fx_rate: number; approximate: boolean; tax_note: string; rate_as_of: string | null; /** True when this is Super Admin's own price for the country rather than a conversion. */ country_priced?: boolean };
    /** What Razorpay will actually charge. */
    charge: Breakdown & { fallback: boolean; reason: string | null; price_locked: boolean; fx_rate: number };
}

const breakdown = (currency: string, subtotal: number, taxPercent: number, decimals = 2): Breakdown => {
    const sub = decimals === 0 ? Math.round(subtotal) : round2(subtotal);
    const tax = round2((sub * taxPercent) / 100);
    const total = round2(sub + tax);
    return { currency, subtotal: sub, tax, tax_percent: taxPercent, total, recurring_amount: total };
};

/** Pure price calculation for one plan and one country (rates and the enabled-currency list are passed in, so it is testable). */
export function buildQuote(
    base: BasePlan,
    countryInput: string | null | undefined,
    rates: RatesResult | null,
    enabled: Set<string>,
    locked?: LockedPrice | null,
    override?: CountryOverride | null,
): Quote {
    const found = currencyForCountry(countryInput) ?? { country: "IN", currency: "INR" };
    const isIndia = found.country === "IN";
    const taxPercent = GST_PERCENT;

    // The Indian price list: price + 18% GST. This is also what a Razorpay plan in INR charges.
    const inr = breakdown("INR", base.price, taxPercent, 2);

    // ── Super Admin's own price for this country (Plans > Country pricing) ───────────────────────────
    // Shown exactly as saved (no conversion, no tax added). It is charged in that currency when Razorpay can bill it; otherwise the
    // customer is billed in INR, as for any other currency that cannot be charged. India never has one.
    if (override && !isIndia && override.currency === found.currency) {
        const b = breakdown(override.currency, override.price, 0, exponentOf(override.currency) === 0 ? 0 : 2);
        const impliedRate = base.price > 0 ? Number((override.price / base.price).toFixed(8)) : 1;
        const display: Quote["display"] = { ...b, fx_rate: impliedRate, approximate: false, tax_note: "excl. applicable taxes", rate_as_of: null, country_priced: true };
        let charge: Quote["charge"];
        if (exponentOf(override.currency) === 2 && isChargeable(enabled, override.currency)) {
            charge = { ...b, fallback: false, reason: null, price_locked: false, fx_rate: impliedRate };
        } else {
            const reason = exponentOf(override.currency) !== 2
                ? `${override.currency} cannot be billed directly, so this subscription is billed in INR.`
                : `Recurring payments in ${override.currency} are not enabled on our payment account yet, so this subscription is billed in INR.`;
            charge = { ...inr, fallback: true, reason, price_locked: false, fx_rate: 1 };
        }
        return { tier: base.tier, cycle: base.cycle, plan_name: base.name, country: found.country, base: inr, display, charge };
    }

    // ── Display (what the pages show) ────────────────────────────────────────────────────────────────
    const rate = found.currency === "INR" ? 1 : rates?.rates[found.currency];
    const displayCurrency = rate ? found.currency : "INR";
    const displayRate = rate ?? 1;
    let display: Quote["display"];
    if (displayCurrency === "INR") {
        // India (or a currency with no rate): rupees, GST on top for India only.
        const b = breakdown("INR", base.price, isIndia ? taxPercent : 0, 2);
        display = { ...b, fx_rate: 1, approximate: false, tax_note: isIndia ? `+ ${taxPercent}% GST` : "excl. applicable taxes", rate_as_of: null };
    } else {
        const converted = round2(base.price * displayRate);
        const b = breakdown(displayCurrency, converted, 0, 2);
        display = { ...b, fx_rate: displayRate, approximate: true, tax_note: "excl. applicable taxes", rate_as_of: rates?.fetchedAt.toISOString() ?? null };
    }

    // ── Charge (what Razorpay bills) ─────────────────────────────────────────────────────────────────
    let charge: Quote["charge"];
    const canChargeDisplayCurrency =
        displayCurrency !== "INR" && isChargeable(enabled, displayCurrency) && exponentOf(displayCurrency) === 2;
    if (canChargeDisplayCurrency) {
        // Charged in the customer's own currency. A held price (see subscription_plan_currency_prices) wins over today's rate.
        const useLocked = locked && locked.currency === displayCurrency ? locked : null;
        const amount = useLocked ? round2(useLocked.amount) : display.subtotal;
        const b = breakdown(displayCurrency, amount, 0, 2);
        charge = { ...b, fallback: false, reason: null, price_locked: Boolean(useLocked), fx_rate: useLocked ? useLocked.fx_rate : displayRate };
    } else {
        let reason: string | null = null;
        if (displayCurrency !== "INR") {
            reason = !isChargeable(enabled, displayCurrency)
                ? `Recurring payments in ${displayCurrency} are not enabled on our payment account yet, so this subscription is billed in INR.`
                : `${displayCurrency} cannot be billed directly, so this subscription is billed in INR.`;
        } else if (found.currency !== "INR") {
            reason = `Live ${found.currency} rates are unavailable right now, so this subscription is billed in INR.`;
        }
        charge = { ...inr, fallback: reason !== null, reason, price_locked: false, fx_rate: 1 };
    }

    return {
        tier: base.tier,
        cycle: base.cycle,
        plan_name: base.name,
        country: found.country,
        base: inr,
        display,
        charge,
    };
}

const SLUG_RE = /^salonox-(basic|advance|growth)-(monthly|quarterly|yearly)$/;

export async function loadBasePlans(): Promise<BasePlan[]> {
    const { rows } = await pool.query(
        `SELECT id, slug, name, price, razorpay_plan_id, razorpay_amount
         FROM subscription_plans WHERE slug LIKE 'salonox-%' AND is_active = TRUE AND price > 0`
    );
    const out: BasePlan[] = [];
    for (const r of rows) {
        const m = SLUG_RE.exec(r.slug as string);
        if (!m) continue;
        out.push({
            id: r.id, slug: r.slug, tier: m[1] as Tier, cycle: m[2] as Cycle, name: r.name,
            price: Number(r.price), razorpay_plan_id: r.razorpay_plan_id ?? null,
            razorpay_amount: r.razorpay_amount == null ? null : Number(r.razorpay_amount),
        });
    }
    return out;
}

/** The held (recent) non-INR price for a plan on the ACTIVE Razorpay account, if one was already set (TEST never holds prices for LIVE). */
export async function findLockedPrice(planId: string, currency: string): Promise<LockedPrice | null> {
    if (currency === "INR" || !(await billingSchemaReady())) return null;
    const days = lockDays();
    if (days <= 0) return null;
    // A currency that has Super Admin country prices also has plans registered at those prices, which must not be mistaken for a held exchange-rate price.
    if (await hasCountryPriceInCurrency(planId, currency)) return null;
    const { rows } = await pool.query(
        `SELECT currency, amount, fx_rate, razorpay_plan_id FROM razorpay_plan_registry
         WHERE plan_id = $1 AND account_key = $2 AND currency = $3 AND created_at > NOW() - ($4 || ' days')::interval
         ORDER BY created_at DESC LIMIT 1`,
        [planId, (await getActiveRazorpayAccount()).key, currency, String(days)]
    );
    const r = rows[0];
    return r ? { currency: r.currency, amount: Number(r.amount), fx_rate: Number(r.fx_rate), razorpay_plan_id: r.razorpay_plan_id ?? null } : null;
}

async function quoteFor(base: BasePlan, country: string | null | undefined, rates: RatesResult | null, overrides: Map<string, CountryOverride>): Promise<Quote> {
    const enabled = await enabledChargeCurrenciesNow();
    const cur =currencyForCountry(country)?.currency;
    const override = overrides.get(base.id) ?? null;
    const locked = !override && cur && cur !== "INR" && isChargeable(enabled, cur) ? await findLockedPrice(base.id, cur) : null;
    return buildQuote(base, country, rates, enabled, locked, override);
}

export const subscriptionPricingService = {
    /** Every plan and cycle for one country, in one response (public: the landing page and registration use it before login). */
    async quoteAll(country: string | null | undefined) {
        const [plans, rates, overrides] = await Promise.all([loadBasePlans(), getInrRates(), loadOverridesForCountry(country)]);
        const quotes = await Promise.all(plans.map((p) => quoteFor(p, country, rates, overrides)));
        const found = currencyForCountry(country) ?? { country: "IN", currency: "INR" };
        return {
            country: found.country,
            country_currency: found.currency,
            display_currency: quotes[0]?.display.currency ?? "INR",
            rate_as_of: rates?.fetchedAt.toISOString() ?? null,
            enabled_charge_currencies: [...(await enabledChargeCurrenciesNow())],
            plans: quotes,
        };
    },

    async quote(tier: unknown, cycle: unknown, country: string | null | undefined) {
        if (!(TIERS as readonly string[]).includes(tier as string) || !(CYCLES as readonly string[]).includes(cycle as string)) {
            throw new AppError(400, "tier must be basic, advance or growth and cycle monthly, quarterly or yearly", "VALIDATION_ERROR");
        }
        const [plans, rates, overrides] = await Promise.all([loadBasePlans(), getInrRates(), loadOverridesForCountry(country)]);
        const base = plans.find((p) => p.tier === tier && p.cycle === cycle);
        if (!base) throw new AppError(404, "This plan isn't available at that billing cycle", "NOT_FOUND");
        return { base, quote: await quoteFor(base, country, rates, overrides) };
    },
};
