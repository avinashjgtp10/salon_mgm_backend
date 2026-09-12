// src/modules/sales/sales.import.logic.ts
//
// Pure, DB-free parsing/allocation/matching logic for the Bulk Billing
// Importer (sales.import.ts) — split out specifically so it can be unit
// tested without a live Postgres connection or mocked repositories. Nothing
// in this file touches the network, the database, or any other module's
// service layer.
import { PaymentMethod } from "./sales.types";

// ─── Multi-item Service/Product cell parsing ───────────────────────────────
// A single Excel row is always exactly one Salonox invoice — but the
// Service/Product cell can list more than one item on that bill, separated
// by commas (e.g. "HAIR CUT LADIES, LOREAL SPA LADIES"). Duplicates are kept
// as separate entries, not deduped/collapsed — "Haircut, Haircut" means two
// haircut line items on the same bill, not one line item with an inferred
// quantity of 2 (the source row never actually says that).
export function parseServiceItemNames(cell: string): string[] {
    return cell
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

// ─── Payment method normalization ──────────────────────────────────────────
// Historical sheets record the specific UPI app the client used (Gpay,
// Google Pay, PhonePe, Paytm, BHIM) rather than the generic "UPI" bucket
// Salonox actually stores payments under — all of those are UPI as far as
// the payments ledger is concerned.
const PAYMENT_METHOD_ALIASES: Record<string, PaymentMethod> = {
    cash: "cash",
    card: "card",
    upi: "upi",
    gpay: "upi",
    "g pay": "upi",
    "google pay": "upi",
    googlepay: "upi",
    phonepe: "upi",
    "phone pe": "upi",
    paytm: "upi",
    bhim: "upi",
    "gift card": "gift_card",
    giftcard: "gift_card",
    split: "split",
    wallet: "wallet",
};

export function normalizePaymentMethod(raw: string | undefined | null): PaymentMethod | undefined {
    if (!raw) return undefined;
    return PAYMENT_METHOD_ALIASES[raw.trim().toLowerCase()];
}

// ─── Exact-total amount allocation ─────────────────────────────────────────
// Splits one row-level financial total across N line items WITHOUT ever
// inventing what each item individually cost — the source Excel gives one
// total for the whole bill, not a per-item price, so an even split (in
// whole paise, with the remainder handed to the first items) is the only
// allocation that doesn't pretend to know something the data doesn't say.
// Guarantees sum(returned) === totalPaise exactly, which is what actually
// matters: the created invoice's total must match the source row's amount
// to the paisa. The per-item split itself is only ever a display/reporting
// convenience on top of that guarantee, never a claim about real pricing.
export function allocateAmountPaise(totalPaise: number, itemCount: number): number[] {
    if (itemCount <= 0) return [];
    const base = Math.floor(totalPaise / itemCount);
    const remainder = totalPaise - base * itemCount;
    return Array.from({ length: itemCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

// ─── Catalog matching ───────────────────────────────────────────────────────
// Exact, case-insensitive, whitespace-trimmed match only — no fuzzy
// matching. A caller-supplied alias map (canonical normalized name keyed by
// a normalized sheet-side spelling) is checked first so known variants
// resolve without needing perfect sheet data, but an unrecognized name is
// always a rejected row, never a guess.
export interface CatalogEntry { id: string; name: string }
export type CatalogMatch = CatalogEntry & { type: "service" | "product" };

export function normalizeItemName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchCatalogItem(
    rawName: string,
    servicesByName: Map<string, CatalogEntry>,
    productsByName: Map<string, CatalogEntry>,
    aliasMap?: Map<string, string>,
): CatalogMatch | undefined {
    const key = normalizeItemName(rawName);
    const resolvedKey = aliasMap?.get(key) ?? key;

    const service = servicesByName.get(resolvedKey);
    if (service) return { ...service, type: "service" };

    const product = productsByName.get(resolvedKey);
    if (product) return { ...product, type: "product" };

    return undefined;
}

// A blank Staff cell doesn't get silently assigned to a random real staff
// member — it's routed to this single, clearly-labeled placeholder (created
// once via the same name-only staff auto-create as any other unmatched
// staff name, then reused for every subsequent blank-staff row), so
// commission/history is attributable to "this bill's staff wasn't recorded"
// rather than disappearing or landing on the wrong person.
export const MISSING_STAFF_PLACEHOLDER_NAME = "Unknown / Imported Staff";
