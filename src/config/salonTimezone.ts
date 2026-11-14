import pool from "./database";

// Salons created before per-salon timezones (and any salon whose column is
// empty) keep behaving exactly as before: India Standard Time.
export const DEFAULT_SALON_TIMEZONE = "Asia/Kolkata";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { tz: string; at: number }>();

const isValidTimezone = (tz: string): boolean => {
    try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
};

// The salon's IANA timezone, from salons.timezone. Cached briefly because
// booking/availability paths call this several times per request. Never
// throws: a lookup failure or an invalid stored value falls back to the
// default so a timezone problem cannot take booking down.
export async function getSalonTimezone(salonId: string): Promise<string> {
    const hit = cache.get(salonId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.tz;

    let tz = DEFAULT_SALON_TIMEZONE;
    try {
        const { rows } = await pool.query(`SELECT timezone FROM salons WHERE id = $1`, [salonId]);
        const stored = rows[0]?.timezone;
        if (typeof stored === "string" && stored && isValidTimezone(stored)) tz = stored;
    } catch {
        // fall through to the default
    }
    cache.set(salonId, { tz, at: Date.now() });
    return tz;
}

// A Date whose UTC getters (getUTCFullYear/Month/Date/Hours...) read the
// salon's local wall clock right now. Lets callers keep doing calendar maths
// with the UTC getters instead of a hardcoded "+5.5h".
export function salonWallClockNow(timeZone: string): Date {
    return salonWallClockAt(new Date(), timeZone);
}

// Same, for any instant.
export function salonWallClockAt(instant: Date, timeZone: string): Date {
    const p = new Intl.DateTimeFormat("en-CA", {
        timeZone, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

// Timezone + currency a NEW salon should start with, from the country chosen at
// sign-up. Only countries we have specific support for are listed; India is
// deliberately absent because the database defaults already are India's, so an
// Indian signup changes nothing. Accepts an ISO code or a country name.
const REGIONAL_DEFAULTS: Record<string, { timezone: string; currency: string }> = {
    AE: { timezone: "Asia/Dubai", currency: "AED" },
};
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
    "united arab emirates": "AE",
    "uae": "AE",
    // Other names the Settings country picker can have saved as free text. Callers compare against "AE" only, so adding
    // names never changes India/UAE behaviour; the festival calendar uses them to find the right country.
    "india": "IN",
    "united states": "US",
    "united states of america": "US",
    "usa": "US",
    "united kingdom": "GB",
    "uk": "GB",
    "canada": "CA",
    "australia": "AU",
    "saudi arabia": "SA",
    "singapore": "SG",
    "malaysia": "MY",
};

// "AE" / "ae" / "United Arab Emirates" -> "AE". Only the countries listed above are recognised by name.
export function normalizeCountryCode(country: string | null | undefined): string | undefined {
    const v = String(country ?? "").trim();
    if (!v) return undefined;
    return v.length === 2 ? v.toUpperCase() : COUNTRY_NAME_TO_CODE[v.toLowerCase()];
}

export function regionalDefaultsForCountry(country: string | null | undefined): { timezone: string; currency: string } | undefined {
    const iso = normalizeCountryCode(country);
    return iso ? REGIONAL_DEFAULTS[iso] : undefined;
}

const countryCache = new Map<string, { country: string | null; at: number }>();

// The salon's saved country (salons.country, as stored: an ISO code or an older free-text name), cached
// briefly. Used to pick country-specific rules such as phone-number length. Never throws.
export async function getSalonCountry(salonId: string): Promise<string | null> {
    const hit = countryCache.get(salonId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.country;
    let country: string | null = null;
    try {
        const { rows } = await pool.query(`SELECT country FROM salons WHERE id = $1`, [salonId]);
        country = rows[0]?.country ?? null;
    } catch {
        // fall through to null (= India rules)
    }
    countryCache.set(salonId, { country, at: Date.now() });
    return country;
}
