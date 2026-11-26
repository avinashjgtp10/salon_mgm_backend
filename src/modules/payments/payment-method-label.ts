import type { Translator } from "../../config/i18n";
import { formatMoney } from "../../config/currency";

// A sale stores its payment method as a short code ("cash", "upi", "card", "split", "pos_machine", a salon's own method name…).
// Emails and messages must show a readable, translated name, and a split bill must show what each part was paid with.
// Wording comes from the receipt's own method names (receipt.method.*) so an e-mail and the printed receipt always agree.

// code (lower-case) -> receipt.method.<key>
const KEY: Record<string, string> = {
    cash: "cash",
    card: "card",
    upi: "upi",
    wallet: "ewallet",
    ewallet: "ewallet",
    gift_card: "giftCard",
    "gift card": "giftCard",
    giftcard: "giftCard",
    package: "package",
    membership: "membership",
    pos_machine: "posMachine",
    "payment machine": "posMachine",
    online: "online",
    online_payment: "online",
    razorpay: "online",
    split: "split",
};

/** One method code -> its readable name. A salon-defined method (Settings > Payment Methods) is shown exactly as the salon named it. */
function nameOf(method: string | null | undefined, t: Translator): string {
    const raw = String(method ?? "").trim();
    if (!raw) return "";
    const key = KEY[raw.toLowerCase()];
    return key ? t(`receipt.method.${key}`) : raw;
}

/**
 * The payment method of a sale as text for an e-mail: "Cash", "UPI", "Card", "Online Payment", a salon's own method name, or for a split
 * bill "Split: Cash ₹1,000.00 + UPI ₹1,500.00" (the parts come from sales.payment_reference, which stores the real per-method amounts).
 * Returns "" when the sale has no method recorded, so the caller decides what to print.
 */
export function describePaymentMethod(
    method: string | null | undefined,
    reference: string | null | undefined,
    t: Translator,
    currency?: string | null,
): string {
    const base = nameOf(method, t);
    if (!base || String(method).trim().toLowerCase() !== "split") return base;

    try {
        const legs = Object.entries(JSON.parse(String(reference ?? "")) as Record<string, unknown>)
            .filter(([, amount]) => Number(amount) > 0)
            .map(([key, amount]) => `${nameOf(key, t)} ${formatMoney(Number(amount), currency)}`);
        if (legs.length) return `${base}: ${legs.join(" + ")}`;
    } catch { /* not a breakdown (or not JSON): fall through to the plain label */ }
    return base;
}
