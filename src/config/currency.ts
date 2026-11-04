import pool from "./database";

// ═══════════════════════════════════════════════════════════════════════════════
// THE single entry point for currency on the backend.
//
// Everything that prints, rounds or defaults a currency — receipts, emails, WhatsApp/SMS text, report cards,
// notifications, API messages, AI prompts — goes through this file, driven by the salon's own currency
// (salons.currency). No other file may contain a currency symbol ("₹", "Rs."), an ISO-code default ("INR") or a
// hand-rolled money formatter; src/config/currency.entry-point.test.ts fails the build if one appears.
// (The frontend has the mirror-image module: src/utils/currency.ts + src/config/currencies.ts.)
//
// The only deliberate exception is the SaaS subscription billing code (subscription-*, plan-pricing, razorpay,
// payment-tracking, super-admin): the platform's own price list is denominated in PLATFORM_BILLING_CURRENCY and is
// not a salon's currency. That list is spelled out in the test.
// ═══════════════════════════════════════════════════════════════════════════════

/** What a salon uses when it has not saved a currency yet. */
export const DEFAULT_CURRENCY = "INR";

/** The currency the platform's own subscription price list is denominated in (not a salon's currency). */
export const PLATFORM_BILLING_CURRENCY = "INR";

interface CurrencyDef {
    /** Printed before the amount. Omit to let Intl choose ("$", "£", "€"…), falling back to the ISO code. */
    symbol?: string;
    /** Locale for digit grouping (INR groups lakh/crore: 1,23,456). */
    numberLocale?: string;
    /** Bills round to this unit: 1 = whole units with a "Round Off" line, 0.01 = exact to the fil/cent. */
    roundingUnit?: number;
    /** ASCII-only label for places that cannot print the symbol: SMS (GSM-7 has no ₹ — using it drops a 160-char segment to 70) and PDFKit documents (standard fonts have no ₹). Defaults to the ISO code. */
    asciiLabel?: string;
    /** English locale that formats this country's dates and clock times (day-first, 12-hour). Omitted = DEFAULT_DATE_LOCALE. */
    dateLocale?: string;
}

/** Date/time locale for any currency without its own: the app's original day-first, 12-hour English format. Also used for platform-level text (support emails) that belongs to no salon. */
export const DEFAULT_DATE_LOCALE = "en-IN";

// Only currencies that need non-default presentation are listed; any other ISO code works with the defaults above
// (Intl symbol, en-US grouping, whole-unit rounding).
const CURRENCIES: Record<string, CurrencyDef> = {
    INR: { symbol: "₹", numberLocale: "en-IN", roundingUnit: 1, asciiLabel: "Rs.", dateLocale: "en-IN" },
    AED: { symbol: "AED", numberLocale: "en-US", roundingUnit: 0.01, dateLocale: "en-AE" },
};

/** Placeholder in message-template wording that is replaced by the salon's currency sign when the template is created. */
export const CURRENCY_MARKER = "¤";

const ISO_RE = /^[A-Z]{3}$/;

export function normalizeCurrency(code: string | null | undefined): string {
    const c = String(code ?? "").trim().toUpperCase();
    return ISO_RE.test(c) ? c : DEFAULT_CURRENCY;
}

function intlSymbol(code: string): string {
    try {
        const part = new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
            .formatToParts(0).find((p) => p.type === "currency");
        return part?.value || code;
    } catch {
        return code;
    }
}

/** The sign printed before an amount: "₹", "AED", "$"… */
export function currencySymbol(code?: string | null): string {
    const c = normalizeCurrency(code);
    return CURRENCIES[c]?.symbol ?? intlSymbol(c);
}

/** Locale to group plain numbers (stock counts, quantities) the way this currency's country does. */
export function numberLocale(code?: string | null): string {
    return CURRENCIES[normalizeCurrency(code)]?.numberLocale ?? "en-US";
}

/**
 * Locale for dates and clock times (toLocaleDateString / toLocaleTimeString / Intl.DateTimeFormat) — never write a
 * locale literal at a call site. With no currency it is the default, which suits platform-level text.
 */
export function dateLocale(code?: string | null): string {
    return CURRENCIES[normalizeCurrency(code)]?.dateLocale ?? DEFAULT_DATE_LOCALE;
}

/** Currency label safe in an SMS or a PDFKit document (no ₹ glyph there): "Rs." for INR, the ISO code ("AED") otherwise. */
export function asciiCurrencyLabel(code?: string | null): string {
    const c = normalizeCurrency(code);
    return CURRENCIES[c]?.asciiLabel ?? c;
}

export interface MoneyOptions {
    /** Digits after the decimal point. Default 2. */
    decimals?: number;
    /** Drop a trailing ".00" (whole amounts print as "₹3,47,993"). */
    trimZeroDecimals?: boolean;
}

/**
 * The one money formatter. formatMoney(1234.5, "INR") -> "₹1,234.50"; (…, "AED") -> "AED 1,234.50".
 * An unknown/blank currency uses DEFAULT_CURRENCY; a non-finite amount prints as 0. Never throws.
 */
export function formatMoney(amount: unknown, currency?: string | null, opts: MoneyOptions = {}): string {
    const code = normalizeCurrency(currency);
    return `${signWithSpacing(currencySymbol(code))}${formatDigits(amount, code, opts)}`;
}

/** formatMoney for places that cannot print the symbol (PDFKit documents): "Rs. 1,234.50" / "AED 1,234.50". */
export function formatMoneyAscii(amount: unknown, currency?: string | null, opts: MoneyOptions = {}): string {
    const code = normalizeCurrency(currency);
    return `${asciiCurrencyLabel(code)} ${formatDigits(amount, code, opts)}`;
}

function formatDigits(amount: unknown, code: string, opts: MoneyOptions): string {
    const decimals = opts.decimals ?? 2;
    const n = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    let digits: string;
    try {
        digits = n.toLocaleString(numberLocale(code), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    } catch {
        digits = n.toFixed(decimals);
    }
    if (opts.trimZeroDecimals && decimals > 0) digits = digits.replace(new RegExp(`\\.0{${decimals}}$`), "");
    return digits;
}

// A sign that ends in a letter ("AED") needs a space before the number; a symbol or abbreviation ("₹", "$", "Rs.") does not.
function signWithSpacing(sign: string): string {
    return /[A-Za-z]$/.test(sign) ? `${sign} ` : sign;
}

/**
 * Replaces CURRENCY_MARKER in message-template wording with the currency's sign, so "¤{{amount}}" becomes
 * "₹{{amount}}" for an Indian salon and "AED {{amount}}" for a UAE one. `sms: true` uses the ASCII-only label.
 */
export function applyCurrencyMarker(text: string, currency?: string | null, opts: { sms?: boolean } = {}): string {
    const sign = opts.sms ? asciiCurrencyLabel(currency) : currencySymbol(currency);
    return text.split(CURRENCY_MARKER).join(signWithSpacing(sign));
}

// ── Per-salon lookups ──────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;
const salonCache = new Map<string, { currency: string; at: number }>();

/** A salon's currency (salons.currency), cached briefly. Never throws: any problem falls back to DEFAULT_CURRENCY. */
export async function getSalonCurrency(salonId: string | null | undefined): Promise<string> {
    if (!salonId) return DEFAULT_CURRENCY;
    const hit = salonCache.get(salonId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.currency;
    let currency = DEFAULT_CURRENCY;
    try {
        const { rows } = await pool.query(`SELECT currency FROM salons WHERE id = $1`, [salonId]);
        currency = normalizeCurrency(rows[0]?.currency);
    } catch {
        // fall through to the default
    }
    salonCache.set(salonId, { currency, at: Date.now() });
    return currency;
}

/** Call after a salon's currency is changed so the next message uses it immediately. */
export function invalidateSalonCurrency(salonId: string): void {
    salonCache.delete(salonId);
}

/** The salon's date/time locale (dateLocale of its currency). */
export async function getSalonDateLocale(salonId: string | null | undefined): Promise<string> {
    return dateLocale(await getSalonCurrency(salonId));
}

/** formatMoney in the salon's own currency. */
export async function formatSalonMoney(salonId: string | null | undefined, amount: unknown, opts?: MoneyOptions): Promise<string> {
    return formatMoney(amount, await getSalonCurrency(salonId), opts);
}

/** A reusable formatter bound to the salon's currency — for code that formats many amounts in one message/report. */
export async function getSalonMoneyFormatter(salonId: string | null | undefined, opts?: MoneyOptions): Promise<(amount: unknown) => string> {
    const currency = await getSalonCurrency(salonId);
    return (amount) => formatMoney(amount, currency, opts);
}

// ── Bill rounding ──────────────────────────────────────────────────────────────────────────────────
export function roundingUnitForCurrency(code: string | null | undefined): number {
    return CURRENCIES[normalizeCurrency(code)]?.roundingUnit ?? 1;
}

/** Rounds to the nearest `unit` (1 = whole units, 0.01 = fils). Exact for 1; guards float residue otherwise. */
export function roundToUnit(value: number, unit: number = 1): number {
    if (unit === 1) return Math.round(value);
    return Number((Math.round(value / unit) * unit).toFixed(6));
}

/** The rounding unit for a salon's bills (read on every checkout/price preview, so it rides the same cache). */
export async function getBillRoundingUnit(salonId: string): Promise<number> {
    return roundingUnitForCurrency(await getSalonCurrency(salonId));
}

/** A sync formatter bound to a known currency code (for callers that already hold the salon row). */
export function moneyFormatter(currency?: string | null, opts?: MoneyOptions): (amount: unknown) => string {
    return (amount) => formatMoney(amount, currency, opts);
}
