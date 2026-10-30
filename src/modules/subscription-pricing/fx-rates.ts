import logger from "../../config/logger";

// Exchange rates for the plan prices, from the SAME source the landing page uses (open.er-api.com, INR base) and with the same
// validation, so a country's converted price is calculated from the same numbers on the landing page and on the server.
// The server caches them for an hour (the browser fetches its own copy), and keeps serving the last good rates for up to a day
// if the service is briefly unreachable.

export type InrRates = Record<string, number>;
export interface RatesResult { rates: InrRates; fetchedAt: Date }

const SOURCE_URL = "https://open.er-api.com/v6/latest/INR";
const FRESH_MS = 60 * 60 * 1000;
const STALE_OK_MS = 24 * 60 * 60 * 1000;

let cache: RatesResult | null = null;
let inflight: Promise<RatesResult | null> | null = null;

// Same rules as the landing page's parseRates: only a successful INR-based response, three-letter codes, positive finite numbers.
export function parseRates(data: unknown): InrRates | null {
    const body = data as { result?: string; base_code?: string; rates?: Record<string, unknown> } | null;
    if (body?.result !== "success" || body.base_code !== "INR" || !body.rates) return null;
    const rates: InrRates = { INR: 1 };
    for (const [code, value] of Object.entries(body.rates)) {
        if (/^[A-Z]{3}$/.test(code) && typeof value === "number" && Number.isFinite(value) && value > 0) rates[code] = value;
    }
    rates.INR = 1;
    return Object.keys(rates).length > 1 ? rates : null;
}

async function fetchRates(): Promise<RatesResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
        const response = await fetch(SOURCE_URL, { signal: controller.signal });
        if (!response.ok) return null;
        const rates = parseRates(await response.json());
        return rates ? { rates, fetchedAt: new Date() } : null;
    } catch (err: any) {
        logger.warn("Exchange-rate fetch failed", { error: err?.message });
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** Current INR-based rates, or null when none are available (callers then fall back to INR, like the landing page). */
export async function getInrRates(): Promise<RatesResult | null> {
    const now = Date.now();
    if (cache && now - cache.fetchedAt.getTime() < FRESH_MS) return cache;
    if (!inflight) {
        inflight = fetchRates().finally(() => { inflight = null; });
    }
    const fresh = await inflight;
    if (fresh) { cache = fresh; return fresh; }
    if (cache && now - cache.fetchedAt.getTime() < STALE_OK_MS) return cache;
    return null;
}

/** Test hook. */
export function __setRatesForTest(value: RatesResult | null) { cache = value; }
