import { upcomingFestivals, festivalsOfYear } from "./festival.calendar";

const keys = (country: string, today: string, daysAhead = 400) =>
    upcomingFestivals({ country, today, daysAhead }).map((f) => `${f.key}:${f.date}`);

describe("festival calendar", () => {
    it("India: Diwali, Holi and Navratri come from the hand-entered table", () => {
        const k = keys("IN", "2026-01-01");
        expect(k).toContain("diwali:2026-11-08");
        expect(k).toContain("holi:2026-03-04");
        expect(k).toContain("navratri:2026-10-11");
    });

    it("India: Eid is computed (library has none) and carries the moon-sighting note", () => {
        const eid = upcomingFestivals({ country: "IN", today: "2026-03-01", daysAhead: 60 }).find((f) => f.key === "eid_al_fitr");
        expect(eid).toBeDefined();
        expect(eid!.date.startsWith("2026-03-")).toBe(true);
        expect(eid!.note).toMatch(/moon/i);
    });

    it("UAE: Ramadan, Eid al-Fitr and National Day", () => {
        const k = keys("AE", "2026-01-01");
        expect(k).toContain("ramadan:2026-02-18");
        expect(k).toContain("eid_al_fitr:2026-03-20");
        expect(k).toContain("uae_national_day:2026-12-02");
        expect(k.some((x) => x.startsWith("diwali"))).toBe(false);
    });

    it("USA: Thanksgiving, Halloween, Christmas, Valentine's", () => {
        const k = keys("US", "2026-01-01");
        expect(k).toContain("thanksgiving:2026-11-26");
        expect(k).toContain("halloween:2026-10-31");
        expect(k).toContain("christmas:2026-12-25");
        expect(k).toContain("valentines:2026-02-14");
    });

    it("accepts a country saved as a name, and treats an unknown country as India", () => {
        expect(keys("United States", "2026-11-01", 60)).toContain("thanksgiving:2026-11-26");
        expect(keys("", "2026-11-01", 60)).toContain("diwali:2026-11-08");
    });

    it("only upcoming ones inside the window, soonest first, with a launch-by date", () => {
        const list = upcomingFestivals({ country: "IN", today: "2026-10-25", daysAhead: 20 });
        expect(list.every((f) => f.daysLeft >= 0 && f.daysLeft <= 20)).toBe(true);
        expect(list.map((f) => f.daysLeft)).toEqual([...list.map((f) => f.daysLeft)].sort((a, b) => a - b));
        const diwali = list.find((f) => f.key === "diwali")!;
        expect(diwali.daysLeft).toBe(14);
        expect(diwali.launchBy).toBe("2026-11-01");
    });

    it("never lists a key twice for the same date", () => {
        const all = festivalsOfYear("IN", null, 2026).map((f) => `${f.key}:${f.date}`);
        expect(new Set(all).size).toBe(all.length);
    });
});
