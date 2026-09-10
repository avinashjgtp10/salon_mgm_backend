// src/modules/sales/sales.import.logic.test.ts
//
// Unit tests for the pure Bulk Billing Importer logic (sales.import.logic.ts).
// These deliberately don't touch the database — the row-processing loop in
// sales.import.ts that calls into DB-backed repositories (client/staff
// auto-create, sale creation, etc.) is integration-level and would need a
// real or mocked Postgres connection to test meaningfully; that isn't set
// up in this project yet (see NOTE at the bottom of this file).
import {
    parseServiceItemNames,
    normalizePaymentMethod,
    allocateAmountPaise,
    matchCatalogItem,
    CatalogEntry,
    MISSING_STAFF_PLACEHOLDER_NAME,
} from "./sales.import.logic";

describe("parseServiceItemNames", () => {
    it("parses a single service", () => {
        expect(parseServiceItemNames("Haircut")).toEqual(["Haircut"]);
    });

    it("parses multiple comma-separated services", () => {
        expect(parseServiceItemNames("HAIR CUT LADIES, LOREAL SPA LADIES"))
            .toEqual(["HAIR CUT LADIES", "LOREAL SPA LADIES"]);
    });

    it("keeps a duplicate service in the same invoice as two separate entries", () => {
        expect(parseServiceItemNames("Haircut, Haircut")).toEqual(["Haircut", "Haircut"]);
    });

    it("trims whitespace and drops empty segments from stray commas", () => {
        expect(parseServiceItemNames(" Haircut ,  , Spa ,")).toEqual(["Haircut", "Spa"]);
    });
});

describe("normalizePaymentMethod", () => {
    it.each(["Gpay", "GPAY", "gpay", "Google Pay", "GooglePay", "PhonePe", "Paytm", "BHIM"])(
        "maps %s to upi",
        (raw) => {
            expect(normalizePaymentMethod(raw)).toBe("upi");
        }
    );

    it("maps plain Cash/Card/UPI unchanged", () => {
        expect(normalizePaymentMethod("Cash")).toBe("cash");
        expect(normalizePaymentMethod("Card")).toBe("card");
        expect(normalizePaymentMethod("UPI")).toBe("upi");
    });

    it("returns undefined for an unrecognized payment method (never guesses)", () => {
        expect(normalizePaymentMethod("Bitcoin")).toBeUndefined();
    });

    it("returns undefined for empty/missing input", () => {
        expect(normalizePaymentMethod(undefined)).toBeUndefined();
        expect(normalizePaymentMethod("")).toBeUndefined();
    });
});

describe("allocateAmountPaise", () => {
    it("splits evenly when the total divides cleanly", () => {
        expect(allocateAmountPaise(10000, 2)).toEqual([5000, 5000]);
    });

    it("distributes the remainder to the first items and always sums exactly", () => {
        const shares = allocateAmountPaise(342200, 3); // ₹3422.00 across 3 items
        expect(shares.reduce((a, b) => a + b, 0)).toBe(342200);
        expect(shares[0]).toBeGreaterThanOrEqual(shares[2]);
    });

    it("returns the whole amount for a single item", () => {
        expect(allocateAmountPaise(50000, 1)).toEqual([50000]);
    });

    it("never loses or invents a paisa across a wide range of splits", () => {
        for (const [paise, n] of [[100, 3], [1, 7], [999999, 11], [342299, 2]] as const) {
            const shares = allocateAmountPaise(paise, n);
            expect(shares).toHaveLength(n);
            expect(shares.reduce((a, b) => a + b, 0)).toBe(paise);
        }
    });
});

describe("matchCatalogItem", () => {
    const services = new Map<string, CatalogEntry>([
        ["hair cut ladies", { id: "svc-1", name: "Hair Cut Ladies" }],
        ["nail polish", { id: "svc-2", name: "Nail Polish" }],
    ]);
    const products = new Map<string, CatalogEntry>([
        ["loreal spa ladies", { id: "prod-1", name: "Loreal Spa Ladies" }],
    ]);

    it("matches a service case-insensitively and trimmed", () => {
        expect(matchCatalogItem("  HAIR CUT LADIES  ", services, products))
            .toEqual({ id: "svc-1", name: "Hair Cut Ladies", type: "service" });
    });

    it("matches case/whitespace variants (NAIL POLISH / nail polish / Nail Polish)", () => {
        for (const variant of ["NAIL POLISH", "nail polish", "Nail   Polish"]) {
            expect(matchCatalogItem(variant, services, products))
                .toEqual({ id: "svc-2", name: "Nail Polish", type: "service" });
        }
    });

    it("falls back to matching a product when no service matches", () => {
        expect(matchCatalogItem("Loreal Spa Ladies", services, products))
            .toEqual({ id: "prod-1", name: "Loreal Spa Ladies", type: "product" });
    });

    it("resolves a configured alias before falling back to a literal match", () => {
        const aliases = new Map([["nailpolish", "nail polish"]]);
        expect(matchCatalogItem("NailPolish", services, products, aliases))
            .toEqual({ id: "svc-2", name: "Nail Polish", type: "service" });
    });

    it("returns undefined for an unknown service — never fuzzy-matches", () => {
        expect(matchCatalogItem("Pedicure Deluxe", services, products)).toBeUndefined();
    });
});

describe("one invoice containing multiple services (parse + match + allocate together)", () => {
    it("resolves both items and allocates the row's total exactly, with no invented per-item price", () => {
        const services = new Map<string, CatalogEntry>([
            ["hair cut ladies", { id: "svc-1", name: "Hair Cut Ladies" }],
        ]);
        const products = new Map<string, CatalogEntry>([
            ["loreal spa ladies", { id: "prod-1", name: "Loreal Spa Ladies" }],
        ]);

        const names = parseServiceItemNames("HAIR CUT LADIES, LOREAL SPA LADIES");
        expect(names).toHaveLength(2);

        const matches = names.map((n) => matchCatalogItem(n, services, products));
        expect(matches.every(Boolean)).toBe(true);
        expect(matches.map((m) => m!.type)).toEqual(["service", "product"]);

        const totalPaise = Math.round(3422 * 100);
        const shares = allocateAmountPaise(totalPaise, matches.length);
        expect(shares).toHaveLength(2);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(totalPaise);
    });

    it("fails to resolve when one of the comma-separated items isn't in the catalog", () => {
        const services = new Map<string, CatalogEntry>([
            ["hair cut ladies", { id: "svc-1", name: "Hair Cut Ladies" }],
        ]);
        const products = new Map<string, CatalogEntry>();

        const names = parseServiceItemNames("HAIR CUT LADIES, SOME MADE UP SERVICE");
        const matches = names.map((n) => matchCatalogItem(n, services, products));
        expect(matches[0]).toBeDefined();
        expect(matches[1]).toBeUndefined(); // the whole row should fail on this
    });
});

describe("missing staff placeholder", () => {
    it("has a stable, clearly-labeled placeholder name (not a random real staff member)", () => {
        expect(MISSING_STAFF_PLACEHOLDER_NAME).toBe("Unknown / Imported Staff");
    });
});

// NOTE: "missing staff" end-to-end (a blank Staff cell actually landing on
// the placeholder staff record, reused across rows) and the full
// parse->match->create->payment flow are exercised by sales.import.ts's
// row loop, which depends on live repositories (clientsService,
// staffRepository, salesRepository, pool) — this project has no ts-jest /
// jest TS transform or DB-mocking harness configured yet, so a true
// integration test isn't runnable as-is. The logic above is factored out
// specifically so the parts that CAN be tested without a database are
// covered; wiring up ts-jest (or converting these to .js) is a separate,
// explicit ask — flagged rather than silently worked around.
