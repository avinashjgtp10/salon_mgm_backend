// The single currency entry point: what it prints for each currency, how the message-template marker resolves (India's
// wording must stay byte-identical), the bill-rounding units, and the per-salon lookup + cache.

const poolQuery = jest.fn();
jest.mock("./database", () => ({ __esModule: true, default: { query: (...a: unknown[]) => poolQuery(...a) } }));

import {
    DEFAULT_CURRENCY,
    PLATFORM_BILLING_CURRENCY,
    CURRENCY_MARKER,
    normalizeCurrency,
    currencySymbol,
    numberLocale,
    DEFAULT_DATE_LOCALE,
    dateLocale,
    getSalonDateLocale,
    asciiCurrencyLabel,
    formatMoney,
    formatMoneyAscii,
    applyCurrencyMarker,
    roundingUnitForCurrency,
    roundToUnit,
    getSalonCurrency,
    invalidateSalonCurrency,
    formatSalonMoney,
    getBillRoundingUnit,
    getSalonMoneyFormatter,
    moneyFormatter,
} from "./currency";

beforeEach(() => {
    poolQuery.mockReset();
});

describe("defaults", () => {
    it("falls back to the default for blank / invalid codes", () => {
        expect(normalizeCurrency(undefined)).toBe(DEFAULT_CURRENCY);
        expect(normalizeCurrency("")).toBe(DEFAULT_CURRENCY);
        expect(normalizeCurrency("rupees")).toBe(DEFAULT_CURRENCY);
        expect(normalizeCurrency(" aed ")).toBe("AED");
    });
    it("keeps the platform price list currency separate from a salon's", () => {
        expect(PLATFORM_BILLING_CURRENCY).toBe("INR");
    });
});

describe("formatMoney", () => {
    it("prints INR with the rupee sign and lakh grouping (unchanged for India)", () => {
        expect(formatMoney(123456.5, "INR")).toBe("₹1,23,456.50");
        expect(formatMoney(0, "INR")).toBe("₹0.00");
    });
    it("prints AED with the code and a space, western grouping", () => {
        expect(formatMoney(1234.5, "AED")).toBe("AED 1,234.50");
    });
    it("uses the symbol Intl gives for other currencies", () => {
        expect(formatMoney(10, "USD")).toBe("$10.00");
    });
    it("treats a blank currency as the default and a bad amount as 0", () => {
        expect(formatMoney(5, null)).toBe("₹5.00");
        expect(formatMoney("abc", "INR")).toBe("₹0.00");
        expect(formatMoney(undefined, "AED")).toBe("AED 0.00");
    });
    it("honours decimals and trimZeroDecimals", () => {
        expect(formatMoney(1234.567, "INR", { decimals: 0 })).toBe("₹1,235");
        expect(formatMoney(347993, "INR", { trimZeroDecimals: true })).toBe("₹3,47,993");
        expect(formatMoney(12.5, "INR", { trimZeroDecimals: true })).toBe("₹12.50");
    });
    it("moneyFormatter is formatMoney bound to a currency", () => {
        expect(moneyFormatter("AED")(10)).toBe("AED 10.00");
    });
});

describe("formatMoneyAscii (PDFKit / SMS-safe)", () => {
    it("never prints the rupee glyph", () => {
        expect(formatMoneyAscii(1500, "INR")).toBe("Rs. 1,500.00");
        expect(formatMoneyAscii(1500, "AED")).toBe("AED 1,500.00");
    });
    it("labels: Rs. for INR, the code otherwise", () => {
        expect(asciiCurrencyLabel("INR")).toBe("Rs.");
        expect(asciiCurrencyLabel("SAR")).toBe("SAR");
    });
});

describe("symbols and locales", () => {
    it("gives the right sign and number locale", () => {
        expect(currencySymbol("INR")).toBe("₹");
        expect(currencySymbol("AED")).toBe("AED");
        expect(numberLocale("INR")).toBe("en-IN");
        expect(numberLocale("AED")).toBe("en-US");
        expect(numberLocale("XXX")).toBe("en-US");
    });
});

describe("date locale", () => {
    const when = new Date("2026-11-04T14:30:00Z");
    it("is India's format for INR, day-first with a 12-hour clock for AED, and India's for anything else", () => {
        expect(dateLocale("INR")).toBe("en-IN");
        expect(dateLocale("AED")).toBe("en-AE");
        expect(dateLocale("USD")).toBe(DEFAULT_DATE_LOCALE);
        expect(dateLocale()).toBe(DEFAULT_DATE_LOCALE);
    });
    it("formats an Indian and a UAE salon's clock times as before / as a 12-hour clock", () => {
        expect(when.toLocaleTimeString(dateLocale("INR"), { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true })).toBe("08:00 pm");
        expect(when.toLocaleTimeString(dateLocale("AED"), { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: true })).toBe("06:30 PM");
        expect(when.toLocaleDateString(dateLocale("AED"), { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric" })).toBe("04 Nov 2026");
    });
    it("looks the salon's currency up", async () => {
        poolQuery.mockResolvedValueOnce({ rows: [{ currency: "AED" }] });
        expect(await getSalonDateLocale("salon-date-locale")).toBe("en-AE");
        expect(await getSalonDateLocale(null)).toBe(DEFAULT_DATE_LOCALE);
    });
});

describe("applyCurrencyMarker (message templates)", () => {
    const body = `Your bill of ${CURRENCY_MARKER}{{amount}} is paid.`;
    it("leaves India's WhatsApp wording exactly as it always was", () => {
        expect(applyCurrencyMarker(body, "INR")).toBe("Your bill of ₹{{amount}} is paid.");
    });
    it("leaves India's SMS/email wording exactly as it always was (Rs. with no space)", () => {
        expect(applyCurrencyMarker(body, "INR", { sms: true })).toBe("Your bill of Rs.{{amount}} is paid.");
    });
    it("writes AED with a space for a UAE salon, in both channels", () => {
        expect(applyCurrencyMarker(body, "AED")).toBe("Your bill of AED {{amount}} is paid.");
        expect(applyCurrencyMarker(body, "AED", { sms: true })).toBe("Your bill of AED {{amount}} is paid.");
    });
    it("replaces every marker", () => {
        expect(applyCurrencyMarker(`${CURRENCY_MARKER}{{a}} / ${CURRENCY_MARKER}{{b}}`, "AED")).toBe("AED {{a}} / AED {{b}}");
    });
});

describe("bill rounding", () => {
    it("rounds whole units for INR and unknown currencies, to the fil for AED", () => {
        expect(roundingUnitForCurrency("INR")).toBe(1);
        expect(roundingUnitForCurrency("USD")).toBe(1);
        expect(roundingUnitForCurrency(null)).toBe(1);
        expect(roundingUnitForCurrency("AED")).toBe(0.01);
    });
    it("roundToUnit matches the old Math.round for 1 and keeps fils for 0.01", () => {
        expect(roundToUnit(61.95, 1)).toBe(62);
        expect(roundToUnit(52.5, 0.01)).toBe(52.5);
        expect(roundToUnit(105.00000000000001, 0.01)).toBe(105);
        expect(roundToUnit(99.994, 0.01)).toBe(99.99);
    });
});

describe("getSalonCurrency", () => {
    it("reads salons.currency once and caches it", async () => {
        poolQuery.mockResolvedValue({ rows: [{ currency: "AED" }] });
        expect(await getSalonCurrency("salon-cache-1")).toBe("AED");
        expect(await getSalonCurrency("salon-cache-1")).toBe("AED");
        expect(poolQuery).toHaveBeenCalledTimes(1);
    });
    it("picks up a changed currency after invalidation", async () => {
        poolQuery.mockResolvedValueOnce({ rows: [{ currency: "INR" }] }).mockResolvedValueOnce({ rows: [{ currency: "AED" }] });
        expect(await getSalonCurrency("salon-cache-2")).toBe("INR");
        invalidateSalonCurrency("salon-cache-2");
        expect(await getSalonCurrency("salon-cache-2")).toBe("AED");
    });
    it("falls back to the default when the salon is missing, the value is junk, or the query fails", async () => {
        poolQuery.mockResolvedValueOnce({ rows: [] });
        expect(await getSalonCurrency("salon-missing")).toBe(DEFAULT_CURRENCY);
        poolQuery.mockResolvedValueOnce({ rows: [{ currency: "??" }] });
        expect(await getSalonCurrency("salon-junk")).toBe(DEFAULT_CURRENCY);
        poolQuery.mockRejectedValueOnce(new Error("db down"));
        expect(await getSalonCurrency("salon-error")).toBe(DEFAULT_CURRENCY);
        expect(await getSalonCurrency(null)).toBe(DEFAULT_CURRENCY);
    });
    it("formatSalonMoney / getSalonMoneyFormatter / getBillRoundingUnit follow the salon's currency", async () => {
        poolQuery.mockResolvedValue({ rows: [{ currency: "AED" }] });
        expect(await formatSalonMoney("salon-fmt", 52.5)).toBe("AED 52.50");
        const fmt = await getSalonMoneyFormatter("salon-fmt", { decimals: 0 });
        expect(fmt(1234)).toBe("AED 1,234");
        expect(await getBillRoundingUnit("salon-fmt")).toBe(0.01);
    });
});
