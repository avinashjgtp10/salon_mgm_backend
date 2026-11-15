import Holidays from "date-holidays";
import { normalizeCountryCode } from "../../config/salonTimezone";

// Which festivals matter to a salon, for its country (and state), and when they fall.
//
// Sources, in order of trust:
//   1. the `date-holidays` library: exact, maintained dates (UAE: Ramadan, both Eids, National Day; USA: Thanksgiving, Halloween…).
//   2. Islamic dates computed from the Umm al-Qura calendar for India, whose library data has no Eid. Moon sighting can make the real
//      day one later, so those entries carry a note.
//   3. INDIA_FESTIVALS below: the Hindu festivals the library does not know (Diwali, Holi…). They move every year and cannot be
//      computed, so this table is typed in by hand and MUST be reviewed each year. A year with no row simply shows no such festival
//      (and logs a warning); we never guess a date.

export interface Festival {
    key: string;
    name: string;
    /** YYYY-MM-DD in the salon's calendar. */
    date: string;
    /** Whole days from the salon's today (0 = today). */
    daysLeft: number;
    /** Latest sensible day to launch a campaign: a week before, or today when it is closer than that. */
    launchBy: string;
    /** Shown as small print when the exact day can differ a little (moon sighting). */
    note?: string;
    ideas: string[];
}

// ── Hand-maintained dates (YYYY-MM-DD) — REVIEW EVERY YEAR ────────────────────────────────────────────────
const INDIA_FESTIVALS: Record<string, Record<string, string>> = {
    "2026": {
        holi: "2026-03-04",
        raksha_bandhan: "2026-08-28",
        ganesh_chaturthi: "2026-09-14",
        navratri: "2026-10-11",
        dussehra: "2026-10-20",
        karwa_chauth: "2026-10-29",
        diwali: "2026-11-08",
        bhai_dooj: "2026-11-11",
    },
    // Only the two biggest ones for 2027; the rest are added once their dates are confirmed.
    "2027": {
        holi: "2027-03-22",
        diwali: "2027-10-29",
    },
};

const NAMES: Record<string, string> = {
    new_year: "New Year",
    new_years_eve: "New Year's Eve",
    valentines: "Valentine's Day",
    womens_day: "Women's Day",
    mothers_day: "Mother's Day",
    friendship_day: "Friendship Day",
    republic_day: "Republic Day",
    independence_day: "Independence Day",
    christmas: "Christmas",
    easter: "Easter",
    halloween: "Halloween",
    thanksgiving: "Thanksgiving",
    black_friday: "Black Friday weekend",
    ramadan: "Ramadan begins",
    eid_al_fitr: "Eid al-Fitr",
    eid_al_adha: "Eid al-Adha",
    uae_national_day: "UAE National Day",
    holi: "Holi",
    raksha_bandhan: "Raksha Bandhan",
    ganesh_chaturthi: "Ganesh Chaturthi",
    navratri: "Navratri",
    dussehra: "Dussehra",
    karwa_chauth: "Karwa Chauth",
    diwali: "Diwali",
    bhai_dooj: "Bhai Dooj",
};

// Ideas are wording only: no prices, discounts or dates are ever invented here.
const GENERIC_IDEAS = [
    "A festive service offer on your most popular service.",
    "A package or membership offer for your regular clients.",
    "A WhatsApp message to past clients inviting them to book early.",
];
const IDEAS: Record<string, string[]> = {
    diwali: ["A Diwali glow package (facial + hair spa) for clients getting ready for the festival.", "A gift card or membership offer for family and friends.", "Early-booking slots for the week before Diwali, which fills up fast."],
    holi: ["A post-Holi hair spa and skin repair offer.", "A pre-Holi hair and skin protection service."],
    karwa_chauth: ["A Karwa Chauth special: makeup, mehndi or hair styling slots to book in advance.", "A combo for friends or family booking together."],
    bhai_dooj: ["A sibling grooming combo.", "A thank-you offer for clients who visited at Diwali."],
    raksha_bandhan: ["A Raksha Bandhan grooming combo for brothers and sisters.", "A gift card for the occasion."],
    navratri: ["Festive makeup and hair styling slots for the nine days.", "A group booking offer for friends and family."],
    dussehra: ["A festive grooming offer around Dussehra."],
    ganesh_chaturthi: ["A festive makeup and hair styling offer.", "Book-ahead slots for the festival days."],
    ramadan: ["Evening and late slots after iftar.", "A pre-Eid beauty package, bookable early."],
    eid_al_fitr: ["An Eid makeover package (hair, makeup, nails).", "Early-booking slots for the days before Eid.", "A family or group booking offer."],
    eid_al_adha: ["An Eid grooming and styling offer.", "Early-booking slots before the holiday."],
    uae_national_day: ["A National Day special for your regular clients.", "A thank-you message with a small offer of your choice."],
    valentines: ["A couples' or friends' pamper package.", "A gift card for someone special.", "A glam-up offer: hair, makeup or a facial before the evening."],
    womens_day: ["A Women's Day pamper offer.", "A package for friends or colleagues booking together."],
    mothers_day: ["A mother-and-daughter pamper offer.", "A gift card for Mother's Day."],
    friendship_day: ["A friends-together offer for two or more people."],
    christmas: ["A party-season makeover package.", "A gift card or membership offer as a present."],
    new_year: ["A new-year refresh offer: haircut, colour or a facial.", "A membership offer for the year ahead."],
    new_years_eve: ["Party hair and makeup slots on the day.", "Book-ahead slots, which fill up quickly."],
    thanksgiving: ["A thank-you offer for loyal clients.", "A gift card for the holiday season."],
    halloween: ["Creative makeup or hair-colour slots for Halloween.", "A themed offer on one service."],
    black_friday: ["A limited-time offer on packages or gift cards."],
    easter: ["A spring refresh offer.", "A family or group booking offer."],
    republic_day: ["A thank-you offer for your clients."],
    independence_day: ["A patriotic-themed offer or a thank-you message for clients."],
};

// ── Library lookups ────────────────────────────────────────────────────────────────────────────────────────

// Library holiday name (English) -> our key. Anything that does not match is ignored (bank holidays, observances a salon has no
// use for), which is how "only relevant festivals" is enforced.
const LIBRARY_MATCHERS: Array<{ re: RegExp; key: string }> = [
    { re: /first day of ramadan/i, key: "ramadan" },
    { re: /eid al-fitr/i, key: "eid_al_fitr" },
    { re: /eid al-adha|feast of the sacrifice/i, key: "eid_al_adha" },
    { re: /^national day$/i, key: "uae_national_day" },
    { re: /^new year.s day$/i, key: "new_year" },
    { re: /^new year.s eve$/i, key: "new_years_eve" },
    { re: /valentine/i, key: "valentines" },
    { re: /mother.s day/i, key: "mothers_day" },
    { re: /^easter sunday$/i, key: "easter" },
    { re: /halloween/i, key: "halloween" },
    { re: /^thanksgiving day$/i, key: "thanksgiving" },
    { re: /^day after thanksgiving/i, key: "black_friday" },
    { re: /^christmas day$/i, key: "christmas" },
    { re: /^republic day$/i, key: "republic_day" },
    { re: /^independence day$/i, key: "independence_day" },
];

const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const dayNumber = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
const addDays = (iso: string, n: number) => ymd(new Date((dayNumber(iso) + n) * 86_400_000));

/** The n-th (1-based) given weekday (0=Sun) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return ymd(new Date(Date.UTC(year, month - 1, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7)));
}

// salons.state is free text ("Maharashtra", "MH"); the library wants its own code.
function resolveStateCode(hd: Holidays, countryCode: string, stateText: string | null | undefined): string | undefined {
    const wanted = String(stateText ?? "").trim().toLowerCase();
    if (!wanted) return undefined;
    try {
        const states = (hd.getStates(countryCode) ?? {}) as Record<string, string>;
        for (const [code, name] of Object.entries(states)) {
            if (code.toLowerCase() === wanted || String(name).toLowerCase() === wanted) return code;
        }
    } catch {
        /* no state data for this country */
    }
    return undefined;
}

function fromLibrary(countryCode: string, state: string | null | undefined, year: number): Array<{ key: string; date: string }> {
    const hd = new Holidays(countryCode);
    hd.setLanguages("en");
    const stateCode = resolveStateCode(hd, countryCode, state);
    const source = stateCode ? new Holidays(countryCode, stateCode) : hd;
    if (stateCode) source.setLanguages("en");
    const out: Array<{ key: string; date: string }> = [];
    for (const h of source.getHolidays(year)) {
        const name = String(h.name ?? "");
        const hit = LIBRARY_MATCHERS.find((m) => m.re.test(name));
        if (hit && !/substitute/i.test(name)) out.push({ key: hit.key, date: String(h.date).slice(0, 10) });
    }
    return out;
}

// Ramadan / Eid dates for a country whose library data lacks them, from the Umm al-Qura (Saudi) calendar.
function islamicDates(year: number): Array<{ key: string; date: string }> {
    const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", timeZone: "UTC" });
    const out: Array<{ key: string; date: string }> = [];
    for (let d = Date.UTC(year, 0, 1); d < Date.UTC(year + 1, 0, 1); d += 86_400_000) {
        const parts = fmt.formatToParts(new Date(d));
        const month = Number(parts.find((p) => p.type === "month")?.value);
        const day = Number(parts.find((p) => p.type === "day")?.value);
        const date = ymd(new Date(d));
        if (month === 9 && day === 1) out.push({ key: "ramadan", date });
        else if (month === 10 && day === 1) out.push({ key: "eid_al_fitr", date });
        else if (month === 12 && day === 10) out.push({ key: "eid_al_adha", date });
    }
    return out;
}

// Occasions that follow a simple rule in every country the salon might be in.
function ruleBased(countryCode: string, year: number): Array<{ key: string; date: string }> {
    const out = [
        { key: "valentines", date: `${year}-02-14` },
        { key: "womens_day", date: `${year}-03-08` },
    ];
    if (countryCode === "AE") out.push({ key: "mothers_day", date: `${year}-03-21` });
    else if (countryCode === "IN" || countryCode === "US") out.push({ key: "mothers_day", date: nthWeekday(year, 5, 0, 2) });
    if (countryCode === "IN") out.push({ key: "friendship_day", date: nthWeekday(year, 8, 0, 1) });
    return out;
}

function indiaTable(year: number): Array<{ key: string; date: string }> {
    const row = INDIA_FESTIVALS[String(year)];
    if (!row) return [];
    return Object.entries(row).map(([key, date]) => ({ key, date }));
}

/** Every relevant festival of one calendar year for a country, de-duplicated by key. */
export function festivalsOfYear(country: string | null | undefined, state: string | null | undefined, year: number): Array<{ key: string; date: string; note?: string }> {
    const code = normalizeCountryCode(country) ?? "IN"; // no/unknown country = India, like the rest of the app
    const found = new Map<string, { key: string; date: string; note?: string }>();
    const put = (list: Array<{ key: string; date: string }>, note?: string) => {
        for (const f of list) if (!found.has(f.key)) found.set(f.key, note ? { ...f, note } : f);
    };

    try {
        put(fromLibrary(code, state, year));
    } catch {
        // a country the library does not know: fall through to the rule-based ones below
    }
    put(ruleBased(code, year));

    if (code === "IN") {
        put(indiaTable(year));
        if (!INDIA_FESTIVALS[String(year)]) {
            // eslint-disable-next-line no-console
            console.warn(`[festivals] no hand-entered Indian festival dates for ${year}; add them to INDIA_FESTIVALS`);
        }
        put(islamicDates(year), "Eid and Ramadan dates follow moon sighting and can be a day later.");
    }
    return [...found.values()];
}

/**
 * Festivals starting today or within `daysAhead` days, soonest first. `today` is the salon's own calendar day (YYYY-MM-DD),
 * so "in 14 days" means 14 days on the salon's clock, whatever time zone the server is in.
 */
export function upcomingFestivals(params: {
    country: string | null | undefined;
    state?: string | null;
    today: string;
    daysAhead?: number;
}): Festival[] {
    const { country, state, today, daysAhead = 90 } = params;
    const year = Number(today.slice(0, 4));
    const todayNum = dayNumber(today);
    const all = [...festivalsOfYear(country, state, year), ...festivalsOfYear(country, state, year + 1)];

    const seen = new Set<string>();
    const out: Festival[] = [];
    for (const f of all) {
        const daysLeft = dayNumber(f.date) - todayNum;
        if (daysLeft < 0 || daysLeft > daysAhead) continue;
        const id = `${f.key}:${f.date}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const launchBy = daysLeft > 7 ? addDays(f.date, -7) : today;
        out.push({ key: f.key, name: NAMES[f.key] ?? f.key, date: f.date, daysLeft, launchBy, ...(f.note ? { note: f.note } : {}), ideas: IDEAS[f.key] ?? GENERIC_IDEAS });
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
