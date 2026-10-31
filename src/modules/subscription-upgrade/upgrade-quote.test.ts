// The upgrade price rules (see upgrade-policy.ts). Every expected figure below is worked out by hand in whole paise,
// independently of the code under test.

import { calculateUpgradeQuote, changeKindOf, convertUpgradeQuote, relationOf, UpgradeError, toPaise } from "./upgrade-quote";
import { loadUpgradePolicy } from "./upgrade-policy";
import { addCycle, normalizeCycle, tierOfPlan } from "../subscription-billing/plan-tier";
import { deriveSubscriptionState, daysRemaining } from "../subscription-billing/subscription-status";

const POLICY = { creditUnusedValue: true, orderValidityMinutes: 30 };
const D = (iso: string) => new Date(iso);

// A 30-day monthly period, 10 days of it left.
const START = D("2026-10-01T00:00:00Z");
const END = D("2026-10-31T00:00:00Z");
const NOW = D("2026-10-21T00:00:00Z");

const advanceMonthlyPaid200 = { tier: "advance" as const, cycle: "monthly" as const, periodStart: START, periodEnd: END, paidSubtotalPaise: 20_000 };

describe("calculateUpgradeQuote", () => {
    it("same cycle: keeps the end date and charges the prorated difference (Advance -> Growth, 10 of 30 days left)", () => {
        const q = calculateUpgradeQuote({
            now: NOW, gstPercent: 18, policy: POLICY,
            current: advanceMonthlyPaid200,
            target: { tier: "growth", cycle: "monthly", pricePaise: 40_000 },
        });
        // new plan for 10/30 of the month: 40000 * 10/30 = 13333.33 -> 13333
        // credit for the unused 10/30 of the ₹200 paid: 20000 * 10/30 = 6666.67 -> 6667
        // taxable = 13333 - 6667 = 6666; GST 18% = 1199.88 -> 1200; total 7866
        expect(q.kind).toBe("upgrade");
        expect(q.remainingDays).toBe(10);
        expect(q.totalDays).toBe(30);
        expect(q.newPlanChargePaise).toBe(13_333);
        expect(q.creditAppliedPaise).toBe(6_667);
        expect(q.subtotalPaise).toBe(6_666);
        expect(q.gstPaise).toBe(1_200);
        expect(q.totalPaise).toBe(7_866);
        expect(q.zeroPayable).toBe(false);
        expect(q.periodEnd.toISOString()).toBe(END.toISOString());          // NOT reset or extended
        expect(q.periodStart.toISOString()).toBe(NOW.toISOString());
    });

    it("different cycle: starts a new full term today, less the unused credit (Advance monthly -> Growth yearly)", () => {
        const q = calculateUpgradeQuote({
            now: NOW, gstPercent: 18, policy: POLICY,
            current: advanceMonthlyPaid200,
            target: { tier: "growth", cycle: "yearly", pricePaise: 4_000_000 },
        });
        // full ₹40,000 - credit 6667 = 3,993,333; GST = 718,799.94 -> 718,800; total 4,712,133
        expect(q.kind).toBe("term_change");
        expect(q.newPlanChargePaise).toBe(4_000_000);
        expect(q.creditAppliedPaise).toBe(6_667);
        expect(q.subtotalPaise).toBe(3_993_333);
        expect(q.gstPaise).toBe(718_800);
        expect(q.totalPaise).toBe(4_712_133);
        expect(q.periodEnd.toISOString()).toBe("2027-10-21T00:00:00.000Z");   // one calendar year from today
    });

    it("zero payable: credit larger than the new charge is capped, and nothing is left to pay", () => {
        const q = calculateUpgradeQuote({
            now: D("2026-10-01T00:00:00Z"), gstPercent: 18, policy: POLICY,
            current: { tier: "basic", cycle: "yearly", periodStart: D("2026-10-01T00:00:00Z"), periodEnd: D("2027-10-01T00:00:00Z"), paidSubtotalPaise: 5_000_000 },
            target: { tier: "advance", cycle: "yearly", pricePaise: 2_000_000 },
        });
        expect(q.creditAppliedPaise).toBe(2_000_000);
        expect(q.unusedCreditPaise).toBe(3_000_000);        // leftover is not refunded or carried forward
        expect(q.subtotalPaise).toBe(0);
        expect(q.gstPaise).toBe(0);
        expect(q.totalPaise).toBe(0);
        expect(q.zeroPayable).toBe(true);
    });

    it("an admin-assigned plan with no payment recorded earns no credit (full prorated charge)", () => {
        const q = calculateUpgradeQuote({
            now: NOW, gstPercent: 18, policy: POLICY,
            current: { ...advanceMonthlyPaid200, paidSubtotalPaise: 0 },
            target: { tier: "growth", cycle: "monthly", pricePaise: 40_000 },
        });
        expect(q.creditAppliedPaise).toBe(0);
        expect(q.subtotalPaise).toBe(13_333);
        expect(q.gstPaise).toBe(2_400);                      // 13333 * 18% = 2399.94 -> 2400
        expect(q.totalPaise).toBe(15_733);
    });

    it("credit can be switched off by policy", () => {
        const q = calculateUpgradeQuote({
            now: NOW, gstPercent: 18, policy: { ...POLICY, creditUnusedValue: false },
            current: advanceMonthlyPaid200,
            target: { tier: "growth", cycle: "monthly", pricePaise: 40_000 },
        });
        expect(q.creditAppliedPaise).toBe(0);
        expect(q.totalPaise).toBe(15_733);
    });

    it("rounds half-up in whole paise at each step", () => {
        // 1 day of 3 left; price 1.50 -> 150 paise * 1/3 = 50 exactly; use 100 paise: 100/3 = 33.33 -> 33
        const q = calculateUpgradeQuote({
            now: D("2026-10-02T00:00:00Z"), gstPercent: 18, policy: { ...POLICY, creditUnusedValue: false },
            current: { tier: "basic", cycle: "monthly", periodStart: D("2026-10-01T00:00:00Z"), periodEnd: D("2026-10-04T00:00:00Z"), paidSubtotalPaise: 0 },
            target: { tier: "advance", cycle: "monthly", pricePaise: 100 },
        });
        expect(q.totalDays).toBe(3);
        expect(q.remainingDays).toBe(2);
        expect(q.newPlanChargePaise).toBe(67);               // 100 * 2/3 = 66.67 -> 67
        expect(q.gstPaise).toBe(12);                         // 67 * 18% = 12.06 -> 12
        expect(q.totalPaise).toBe(79);
    });

    it("refuses an expired subscription (that is a renewal, not an upgrade)", () => {
        expect(() => calculateUpgradeQuote({
            now: D("2026-11-05T00:00:00Z"), gstPercent: 18, policy: POLICY, current: advanceMonthlyPaid200,
            target: { tier: "growth", cycle: "monthly", pricePaise: 40_000 },
        })).toThrow(expect.objectContaining({ code: "EXPIRED" }));
    });

    it("refuses the same plan and refuses a lower plan", () => {
        const base = { now: NOW, gstPercent: 18, policy: POLICY, current: advanceMonthlyPaid200 };
        expect(() => calculateUpgradeQuote({ ...base, target: { tier: "advance", cycle: "monthly", pricePaise: 20_000 } }))
            .toThrow(expect.objectContaining({ code: "SAME_PLAN" }));
        expect(() => calculateUpgradeQuote({ ...base, target: { tier: "basic", cycle: "monthly", pricePaise: 10_000 } }))
            .toThrow(expect.objectContaining({ code: "NOT_AN_UPGRADE" }));
        expect(UpgradeError).toBeDefined();
    });
});

describe("relationOf", () => {
    it("classifies plans against the current one", () => {
        const cur = { tier: "advance" as const, cycle: "monthly" as const };
        expect(relationOf(cur, { tier: "advance", cycle: "monthly" })).toBe("current");
        expect(relationOf(cur, { tier: "growth", cycle: "monthly" })).toBe("upgrade");
        expect(relationOf(cur, { tier: "growth", cycle: "yearly" })).toBe("upgrade");
        expect(relationOf(cur, { tier: "advance", cycle: "yearly" })).toBe("upgrade");      // same tier, longer cycle
        expect(relationOf({ tier: "advance", cycle: "yearly" }, { tier: "advance", cycle: "monthly" })).toBe("change");
        expect(relationOf(cur, { tier: "basic", cycle: "yearly" })).toBe("change");         // lower tier
        expect(relationOf(null, { tier: "basic", cycle: "monthly" })).toBe("upgrade");       // no plan yet: any plan is a purchase
        expect(relationOf({ tier: null, cycle: "yearly" }, { tier: "basic", cycle: "monthly" })).toBe("upgrade");
    });
});

describe("every plan and billing cycle can be reached from every other (3 plans x 3 cycles = 81 moves)", () => {
    const TIERS = ["basic", "advance", "growth"] as const;
    const CYCLES = ["monthly", "quarterly", "yearly"] as const;
    const RANK = { basic: 1, advance: 2, growth: 3 };
    const MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
    const PRICE_PAISE = { basic: 79_900, advance: 99_900, growth: 129_900 };   // monthly list prices; longer cycles are multiples
    const priceOf = (t: (typeof TIERS)[number], c: (typeof CYCLES)[number]) => PRICE_PAISE[t] * MONTHS[c];
    const period = (c: (typeof CYCLES)[number]) => {
        const start = D("2026-10-01T00:00:00Z");
        return { periodStart: start, periodEnd: addCycle(start, c) };
    };

    for (const ct of TIERS) for (const cc of CYCLES) for (const tt of TIERS) for (const tc of CYCLES) {
        const label = `${ct} ${cc} -> ${tt} ${tc}`;
        const cur = { tier: ct, cycle: cc };
        const tgt = { tier: tt, cycle: tc };
        const same = ct === tt && cc === tc;
        const higher = RANK[tt] > RANK[ct];
        const lower = RANK[tt] < RANK[ct];
        const kind = same ? "current" : higher ? "upgrade" : lower ? "downgrade" : "cycle_change";
        // paid immediately: a higher plan, or the same plan on a longer cycle; scheduled for the end of the period: everything else
        const relation = same ? "current" : higher || (!lower && MONTHS[tc] > MONTHS[cc]) ? "upgrade" : "change";

        it(`${label}: ${kind}, ${relation === "upgrade" ? "paid now" : relation === "change" ? "scheduled for the period end" : "already current"}`, () => {
            expect(changeKindOf(cur, tgt)).toBe(kind);
            expect(relationOf(cur, tgt)).toBe(relation);

            const run = () => calculateUpgradeQuote({
                now: D("2026-10-11T00:00:00Z"), gstPercent: 18, policy: POLICY,
                current: { ...cur, ...period(cc), paidSubtotalPaise: priceOf(ct, cc) },
                target: { ...tgt, pricePaise: priceOf(tt, tc) },
            });
            if (relation === "current") return expect(run).toThrow(expect.objectContaining({ code: "SAME_PLAN" }));
            if (relation === "change") return expect(run).toThrow(expect.objectContaining({ code: "NOT_AN_UPGRADE" }));

            const q = run();
            expect(q.kind).toBe(cc === tc ? "upgrade" : "term_change");
            expect(q.subtotalPaise).toBe(q.newPlanChargePaise - q.creditAppliedPaise);
            expect(q.gstPaise).toBe(Math.round((q.subtotalPaise * 18) / 100));
            expect(q.totalPaise).toBe(q.subtotalPaise + q.gstPaise);
            expect(q.creditAppliedPaise).toBeLessThanOrEqual(q.newPlanChargePaise);
            expect(q.totalPaise).toBeGreaterThanOrEqual(0);
            expect(q.periodEnd.getTime()).toBeGreaterThan(D("2026-10-11T00:00:00Z").getTime());
            if (cc === tc) expect(q.periodEnd.toISOString()).toBe(period(cc).periodEnd.toISOString());   // same cycle keeps the end date
        });
    }

    it("a new term turns credit left over after paying for it into extra days, so paid time is not lost (Advance yearly -> Growth monthly)", () => {
        const q = calculateUpgradeQuote({
            now: D("2026-10-21T00:00:00Z"), gstPercent: 18, policy: POLICY,
            current: { tier: "advance", cycle: "yearly", periodStart: D("2026-08-17T00:00:00Z"), periodEnd: D("2027-08-17T00:00:00Z"), paidSubtotalPaise: 1_200_000 },
            target: { tier: "growth", cycle: "monthly", pricePaise: 130_000 },
        });
        // credit 1,200,000 x 300/365 = 986,301; the month costs 130,000; the other 856,301 buys floor(856,301 / (130,000 / 31 days)) = 204 days
        expect(q.creditAppliedPaise).toBe(130_000);
        expect(q.totalPaise).toBe(0);
        expect(q.zeroPayable).toBe(true);
        expect(q.bonusDays).toBe(204);
        expect(q.periodEnd.toISOString()).toBe("2027-06-13T00:00:00.000Z");   // 21 Nov 2026 (one month) + 204 days
        expect(q.unusedCreditPaise).toBe(817);                                  // less than one day of the new plan: not refunded
    });

    it("no extra days when the credit does not cover the new term, or on a same-cycle upgrade", () => {
        const q = calculateUpgradeQuote({
            now: NOW, gstPercent: 18, policy: POLICY, current: advanceMonthlyPaid200,
            target: { tier: "growth", cycle: "yearly", pricePaise: 4_000_000 },
        });
        expect(q.bonusDays).toBe(0);
        const same = calculateUpgradeQuote({
            now: D("2026-10-01T00:00:00Z"), gstPercent: 18, policy: POLICY,
            current: { tier: "basic", cycle: "yearly", periodStart: D("2026-10-01T00:00:00Z"), periodEnd: D("2027-10-01T00:00:00Z"), paidSubtotalPaise: 5_000_000 },
            target: { tier: "advance", cycle: "yearly", pricePaise: 2_000_000 },
        });
        expect(same.bonusDays).toBe(0);
        expect(same.unusedCreditPaise).toBe(3_000_000);
    });
});

describe("plan helpers", () => {
    it("works out a plan's tier and cycle", () => {
        expect(tierOfPlan({ tier: "growth" })).toBe("growth");
        expect(tierOfPlan({ name: "SalonOx Pro" })).toBe("growth");
        expect(tierOfPlan({ name: "SalonOx Advance" })).toBe("advance");
        expect(tierOfPlan({ slug: "salonox-basic-yearly" })).toBe("basic");
        expect(tierOfPlan({ name: "Manual Grant", slug: "manual-grant" })).toBeNull();
        expect(normalizeCycle("annual")).toBe("yearly");
        expect(normalizeCycle("weekly")).toBeNull();
    });

    it("adds calendar months without overflowing short months", () => {
        expect(addCycle(D("2027-01-31T10:00:00Z"), "monthly").toISOString()).toBe("2027-02-28T10:00:00.000Z");
        expect(addCycle(D("2026-11-30T00:00:00Z"), "quarterly").toISOString()).toBe("2027-02-28T00:00:00.000Z");
        expect(addCycle(D("2026-10-21T00:00:00Z"), "yearly").toISOString()).toBe("2027-10-21T00:00:00.000Z");
    });

    it("converts rupees to paise without drift", () => {
        expect(toPaise(1180)).toBe(118_000);
        expect(toPaise(0.1 + 0.2)).toBe(30);
    });

    it("reads the policy from the environment", () => {
        expect(loadUpgradePolicy({} as NodeJS.ProcessEnv)).toEqual({ creditUnusedValue: true, orderValidityMinutes: 30 });
        expect(loadUpgradePolicy({ UPGRADE_CREDIT_ENABLED: "false", UPGRADE_ORDER_VALIDITY_MINUTES: "10" } as unknown as NodeJS.ProcessEnv))
            .toEqual({ creditUnusedValue: false, orderValidityMinutes: 10 });
    });
});

describe("deriveSubscriptionState", () => {
    const now = D("2026-10-21T00:00:00Z");
    const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

    it("derives the status shown to the salon", () => {
        expect(deriveSubscriptionState({ status: "active", periodEnd: days(200), now })).toBe("active");
        expect(deriveSubscriptionState({ status: "active", periodEnd: days(30), now })).toBe("expiring_soon");
        expect(deriveSubscriptionState({ status: "active", periodEnd: days(10), now })).toBe("expiring_soon");
        expect(deriveSubscriptionState({ status: "active", periodEnd: days(-1), now })).toBe("expired");
        expect(deriveSubscriptionState({ status: "trialing", periodEnd: days(3), now })).toBe("expiring_soon");
        expect(deriveSubscriptionState({ status: "created", periodEnd: null, now })).toBe("pending_payment");
        expect(deriveSubscriptionState({ status: "authenticated", periodEnd: null, now })).toBe("pending_payment");
        expect(deriveSubscriptionState({ status: "paused", periodEnd: days(50), now })).toBe("suspended");
        expect(deriveSubscriptionState({ status: "active", periodEnd: days(50), now, salonActive: false })).toBe("suspended");
        expect(deriveSubscriptionState({ status: "cancelled", periodEnd: days(50), now })).toBe("expired");
        expect(deriveSubscriptionState({ status: "upgraded", periodEnd: days(50), now })).toBe("expired");
    });

    it("counts whole days left, rounded up", () => {
        expect(daysRemaining(days(5), now)).toBe(5);
        expect(daysRemaining(new Date(now.getTime() + 60_000), now)).toBe(1);
        expect(daysRemaining(null, now)).toBeNull();
    });
});

describe("convertUpgradeQuote (overseas customer: same quote in another currency, no Indian GST)", () => {
    // Same figures as the Advance -> Growth example above, but calculated with no GST: new charge 13333, credit 6667, subtotal 6666.
    const inr = () => calculateUpgradeQuote({
        now: NOW, gstPercent: 0, policy: POLICY,
        current: advanceMonthlyPaid200,
        target: { tier: "growth", cycle: "monthly", pricePaise: 40_000 },
    });

    it("converts each line at the rate and rebuilds the subtotal from the converted lines", () => {
        const q = convertUpgradeQuote(inr(), 0.01);   // 1 INR = 0.01 USD
        // 13333 * 0.01 = 133.33 -> 133; 6667 * 0.01 = 66.67 -> 67; subtotal = 133 - 67 = 66; no tax
        expect(q.newPlanChargePaise).toBe(133);
        expect(q.creditAppliedPaise).toBe(67);
        expect(q.subtotalPaise).toBe(66);
        expect(q.gstPaise).toBe(0);
        expect(q.totalPaise).toBe(66);
        expect(q.newPlanChargePaise - q.creditAppliedPaise).toBe(q.subtotalPaise);
        expect(q.zeroPayable).toBe(false);
        expect(q.remainingDays).toBe(10);
    });

    it("never lets the credit exceed the converted charge, and flags a zero payable result", () => {
        const q = convertUpgradeQuote({ ...inr(), newPlanChargePaise: 1000, creditAppliedPaise: 1000, unusedCreditPaise: 0, subtotalPaise: 0, totalPaise: 0, zeroPayable: true }, 0.0123);
        expect(q.creditAppliedPaise).toBeLessThanOrEqual(q.newPlanChargePaise);
        expect(q.totalPaise).toBe(0);
        expect(q.zeroPayable).toBe(true);
    });

    it("refuses a missing or non-positive rate", () => {
        expect(() => convertUpgradeQuote(inr(), 0)).toThrow(UpgradeError);
    });
});
