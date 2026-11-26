// Pure rules for duration options: price maths, validation, labels and expiry dates. No database, no Razorpay, so every rule
// here is unit-tested (duration-pricing.test.ts) and the server, not the browser, is the only place an amount is decided.

export const DURATION_UNITS = ["days", "months", "years"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const DURATION_TIERS = ["basic", "advance", "growth"] as const;
export type DurationTier = (typeof DURATION_TIERS)[number];

export const isDurationUnit = (v: unknown): v is DurationUnit => typeof v === "string" && (DURATION_UNITS as readonly string[]).includes(v);
export const isDurationTier = (v: unknown): v is DurationTier => typeof v === "string" && (DURATION_TIERS as readonly string[]).includes(v);

/** The longest term an option may have, per unit (keeps expiry dates sane and stops a typo like 36500 months). */
export const MAX_DURATION: Record<DurationUnit, number> = { days: 3650, months: 120, years: 10 };

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const toPaise = (rupees: number): number => Math.round(rupees * 100);

/** GST amount and the final customer price for a base price. Everything is rounded to the paisa, the same way every time. */
export function calculatePricing(basePrice: number, gstPercent: number): { gstAmount: number; finalPrice: number } {
    const base = round2(basePrice);
    const gstAmount = round2((base * gstPercent) / 100);
    return { gstAmount, finalPrice: round2(base + gstAmount) };
}

/** "3 Months", "1 Year", "45 Days": the label shown when the admin did not type one. */
export function defaultLabel(value: number, unit: DurationUnit): string {
    const word = unit === "days" ? "Day" : unit === "months" ? "Month" : "Year";
    return `${value} ${word}${value === 1 ? "" : "s"}`;
}

export interface OptionInput { tier: unknown; durationValue: unknown; durationUnit: unknown; basePrice: unknown; gstPercent: unknown; label?: unknown }
export interface CleanOption {
    tier: DurationTier; durationValue: number; durationUnit: DurationUnit; basePrice: number; gstPercent: number; label: string;
    gstAmount: number; finalPrice: number;
}

/** Validates admin input and returns the cleaned option (with GST and final price worked out), or the first problem found. */
export function cleanOption(input: OptionInput): { ok: true; value: CleanOption } | { ok: false; message: string } {
    if (!isDurationTier(input.tier)) return { ok: false, message: "Choose a plan: basic, advance or growth." };
    const value = Number(input.durationValue);
    if (!Number.isInteger(value) || value < 1) return { ok: false, message: "Duration must be a whole number of 1 or more." };
    if (!isDurationUnit(input.durationUnit)) return { ok: false, message: "Unit must be days, months or years." };
    if (value > MAX_DURATION[input.durationUnit]) return { ok: false, message: `Duration can be at most ${MAX_DURATION[input.durationUnit]} ${input.durationUnit}.` };
    const base = Number(input.basePrice);
    // A free option could never be "activated after a confirmed payment", so a price is required.
    if (!Number.isFinite(base) || base <= 0 || base > 100_000_000) return { ok: false, message: "Base price must be greater than 0." };
    const gst = Number(input.gstPercent ?? 18);
    if (!Number.isFinite(gst) || gst < 0 || gst > 100) return { ok: false, message: "GST must be between 0 and 100 percent." };
    const rawLabel = typeof input.label === "string" ? input.label.trim() : "";
    if (rawLabel.length > 60) return { ok: false, message: "Label can be at most 60 characters." };
    const { gstAmount, finalPrice } = calculatePricing(base, gst);
    return {
        ok: true,
        value: {
            tier: input.tier, durationValue: value, durationUnit: input.durationUnit, basePrice: round2(base), gstPercent: round2(gst),
            label: rawLabel || defaultLabel(value, input.durationUnit), gstAmount, finalPrice,
        },
    };
}

/** `from` plus N calendar months (31 Jan + 1 month = 28/29 Feb, never 3 Mar). Works in UTC. */
export function addMonths(from: Date, months: number): Date {
    const d = new Date(from.getTime());
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d;
}

/** When a term that starts at `start` and lasts `value` `unit` ends. */
export function addDuration(start: Date, value: number, unit: DurationUnit): Date {
    if (unit === "days") return new Date(start.getTime() + value * 24 * 60 * 60 * 1000);
    return addMonths(start, unit === "years" ? value * 12 : value);
}

export type PurchaseKind = "new" | "renewal" | "upgrade";

export interface CurrentTerm { tier: DurationTier | null; end: Date | null; live: boolean; trial: boolean }

export const TIER_RANK: Record<DurationTier, number> = { basic: 1, advance: 2, growth: 3 };

/**
 * What buying `targetTier` means for a salon in its current state:
 *   - no live plan, or only a trial            -> "new": the term starts now;
 *   - the same plan while live                 -> "renewal": the term starts when the current one ends (no days are lost);
 *   - a higher plan while live                 -> "upgrade": the term starts now and replaces the current one;
 *   - a lower plan while live                  -> refused (the owner can buy it after the current term ends).
 */
export function decidePurchase(current: CurrentTerm | null, targetTier: DurationTier, now: Date): { kind: PurchaseKind; start: Date } | { refused: string } {
    if (!current || !current.live || current.trial) return { kind: "new", start: now };
    if (current.tier === targetTier) return { kind: "renewal", start: current.end && current.end.getTime() > now.getTime() ? current.end : now };
    if (!current.tier || TIER_RANK[targetTier] > TIER_RANK[current.tier]) return { kind: "upgrade", start: now };
    return { refused: "Your current plan is higher than this one. You can choose it after your current plan ends." };
}

/** Whole calendar days from `now` to `end`, never negative. */
export function remainingDays(end: Date, now: Date): number {
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}
