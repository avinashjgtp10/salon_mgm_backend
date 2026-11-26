import {
    addDuration, addMonths, calculatePricing, cleanOption, decidePurchase, defaultLabel, remainingDays, toPaise,
} from "./duration-pricing";

const NOW = new Date("2026-11-23T10:00:00.000Z");

describe("calculatePricing", () => {
    it("adds GST to the base price and rounds to the paisa", () => {
        expect(calculatePricing(1000, 18)).toEqual({ gstAmount: 180, finalPrice: 1180 });
        expect(calculatePricing(2499, 18)).toEqual({ gstAmount: 449.82, finalPrice: 2948.82 });
        expect(calculatePricing(999.99, 5)).toEqual({ gstAmount: 50, finalPrice: 1049.99 });
    });
    it("handles 0% GST and a free option", () => {
        expect(calculatePricing(500, 0)).toEqual({ gstAmount: 0, finalPrice: 500 });
        expect(calculatePricing(0, 18)).toEqual({ gstAmount: 0, finalPrice: 0 });
    });
    it("converts rupees to whole paise without float drift", () => {
        expect(toPaise(2948.82)).toBe(294882);
        expect(toPaise(0.1 + 0.2)).toBe(30);
    });
});

describe("cleanOption", () => {
    const good = { tier: "basic", durationValue: 3, durationUnit: "months", basePrice: 1000, gstPercent: 18 };
    it("accepts a predefined duration and fills the label, GST and final price", () => {
        const r = cleanOption(good);
        expect(r.ok && r.value).toMatchObject({ label: "3 Months", gstAmount: 180, finalPrice: 1180 });
    });
    it("accepts custom durations in days, months and years", () => {
        expect(cleanOption({ ...good, durationValue: 45, durationUnit: "days" })).toMatchObject({ ok: true });
        expect(cleanOption({ ...good, durationValue: 18, durationUnit: "months" })).toMatchObject({ ok: true });
        expect(cleanOption({ ...good, durationValue: 2, durationUnit: "years" })).toMatchObject({ ok: true });
    });
    it("rejects bad input", () => {
        expect(cleanOption({ ...good, tier: "pro" })).toMatchObject({ ok: false });
        expect(cleanOption({ ...good, durationValue: 0 })).toMatchObject({ ok: false });
        expect(cleanOption({ ...good, durationValue: 1.5 })).toMatchObject({ ok: false });
        expect(cleanOption({ ...good, durationUnit: "weeks" })).toMatchObject({ ok: false });
        expect(cleanOption({ ...good, durationValue: 121, durationUnit: "months" })).toMatchObject({ ok: false });
        expect(cleanOption({ ...good, basePrice: -1 })).toMatchObject({ ok: false });
        expect(cleanOption({ ...good, basePrice: 0 })).toMatchObject({ ok: false });
        expect(cleanOption({ ...good, gstPercent: 101 })).toMatchObject({ ok: false });
    });
    it("uses the admin's own label when given", () => {
        const r = cleanOption({ ...good, label: "Quarter special" });
        expect(r.ok && r.value.label).toBe("Quarter special");
    });
    it("labels singular and plural", () => {
        expect(defaultLabel(1, "years")).toBe("1 Year");
        expect(defaultLabel(6, "months")).toBe("6 Months");
        expect(defaultLabel(1, "days")).toBe("1 Day");
    });
});

describe("addDuration (expiry dates)", () => {
    const start = new Date("2026-11-23T10:00:00.000Z");
    it("3, 6 and 12 months", () => {
        expect(addDuration(start, 3, "months").toISOString()).toBe("2027-02-23T10:00:00.000Z");
        expect(addDuration(start, 6, "months").toISOString()).toBe("2027-05-23T10:00:00.000Z");
        expect(addDuration(start, 12, "months").toISOString()).toBe("2027-11-23T10:00:00.000Z");
    });
    it("custom: days and years", () => {
        expect(addDuration(start, 45, "days").toISOString()).toBe("2027-01-07T10:00:00.000Z");
        expect(addDuration(start, 2, "years").toISOString()).toBe("2028-11-23T10:00:00.000Z");
    });
    it("clamps to the last day of a shorter month", () => {
        expect(addMonths(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
        expect(addMonths(new Date("2028-01-31T00:00:00.000Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
    });
});

describe("decidePurchase (new / renewal / upgrade)", () => {
    const live = (tier: any, end: string, trial = false) => ({ tier, end: new Date(end), live: true, trial });
    it("no plan, an expired plan or a trial starts a NEW term now", () => {
        expect(decidePurchase(null, "basic", NOW)).toEqual({ kind: "new", start: NOW });
        expect(decidePurchase({ tier: "basic", end: new Date("2026-01-01"), live: false, trial: false }, "basic", NOW)).toEqual({ kind: "new", start: NOW });
        expect(decidePurchase(live("basic", "2026-12-01", true), "advance", NOW)).toEqual({ kind: "new", start: NOW });
    });
    it("the same plan while live is a RENEWAL that starts when the current term ends", () => {
        const r = decidePurchase(live("advance", "2027-01-10T00:00:00.000Z"), "advance", NOW) as any;
        expect(r.kind).toBe("renewal");
        expect(r.start.toISOString()).toBe("2027-01-10T00:00:00.000Z");
    });
    it("a higher plan while live is an UPGRADE that starts now", () => {
        expect(decidePurchase(live("basic", "2027-01-10"), "growth", NOW)).toEqual({ kind: "upgrade", start: NOW });
    });
    it("a lower plan while live is refused", () => {
        expect(decidePurchase(live("growth", "2027-01-10"), "basic", NOW)).toHaveProperty("refused");
    });
});

describe("remainingDays", () => {
    it("counts days left and never goes negative", () => {
        expect(remainingDays(new Date("2026-12-23T10:00:00.000Z"), NOW)).toBe(30);
        expect(remainingDays(new Date("2026-11-01T00:00:00.000Z"), NOW)).toBe(0);
    });
});

// Every plan x every standard term: GST, final price and expiry are right, and each is a prepaid purchase of its own tier.
describe.each(["basic", "advance", "growth"] as const)("%s plan", (tier) => {
    it.each([[3, "2026-04-15"], [6, "2026-07-15"], [12, "2027-01-15"]])("%i months from 15 Jan 2026 ends %s", (months, end) => {
        const p = calculatePricing(1000, 18);
        expect(p.gstAmount).toBe(180);
        expect(p.finalPrice).toBe(1180);
        expect(addDuration(new Date("2026-01-15T00:00:00Z"), months, "months").toISOString().slice(0, 10)).toBe(end);
        expect(decidePurchase(null, tier, new Date("2026-01-15T00:00:00Z"))).toMatchObject({ kind: "new" });
    });
});
