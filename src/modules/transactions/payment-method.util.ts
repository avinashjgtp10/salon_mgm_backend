import type { PaymentMethod } from "../sales/sales.types";
import { UnrecognizedPaymentMethodError } from "./transaction.types";

const SINGLE_METHOD_MAP: Record<string, PaymentMethod> = {
  cash: "cash",
  card: "card",
  upi: "upi",
};

export interface NormalizedPaymentMethod {
  method: PaymentMethod;
  /** The real per-method breakdown, stored as JSON in sales.payment_reference for split/wallet-in-split cases. */
  reference?: string;
}

/**
 * Maps the frontend's raw payment labels (built by buildMethodLabel() in
 * paymentUtils.ts — a small, enumerable set: "Cash" | "Card" | "UPI" |
 * "Payment Machine", any "+"-joined combination of Cash/Card/UPI, or
 * "eWallet") to the real sales_payment_method_check constraint values.
 * Never lets an unrecognized raw label reach the INSERT — that's what
 * silently broke sale creation for composite labels before this module
 * existed, and what would have broken it again for "Payment Machine" had
 * it not been added here too.
 */
function resolveMoneyMethod(
  label: string,
  splitDetails?: Record<string, number>
): NormalizedPaymentMethod {
  const activeLegs = Object.entries(splitDetails ?? {}).filter(([, amount]) => Number(amount) > 0);
  const cashCardUpiLegs = activeLegs.filter(([key]) => key.toLowerCase() !== "ewallet");

  // Multiple real (non-wallet) legs paid this bill -> genuinely split.
  if (cashCardUpiLegs.length > 1) {
    return { method: "split", reference: JSON.stringify(Object.fromEntries(activeLegs)) };
  }

  const normalizedLabel = (label ?? "").trim().toLowerCase();

  // Exact single-method match.
  if (normalizedLabel in SINGLE_METHOD_MAP) {
    return { method: SINGLE_METHOD_MAP[normalizedLabel] };
  }

  // eWallet is its own payment method, not folded into "split".
  if (normalizedLabel === "ewallet") {
    return { method: "wallet" };
  }

  // Payment Machine (POS terminal) — buildMethodLabel() returns the raw
  // singleMethod value unchanged for it, same as "Cash"/"Card"/"UPI" do.
  // Without this branch it fell through to UnrecognizedPaymentMethodError
  // below, exactly the silent sale-creation failure this module's header
  // comment describes for "Cash+Card"/"eWallet" before it existed — the
  // payments row still succeeded (no constraint there), so the appointment
  // showed PAID with no invoice number.
  if (normalizedLabel === "payment machine") {
    return { method: "pos_machine" };
  }

  if (normalizedLabel === "gift_card" || normalizedLabel === "gift card" || normalizedLabel === "giftcard") {
    return { method: "gift_card" };
  }

  // "Cash+Card", "Cash+UPI", "Card+UPI", "Cash+Card+UPI" — buildMethodLabel()'s
  // "+"-joined form. Only trust this if every joined part is itself a real method.
  if (normalizedLabel.includes("+")) {
    const parts = normalizedLabel.split("+").map((p) => p.trim());
    if (parts.length > 1 && parts.every((p) => p in SINGLE_METHOD_MAP)) {
      const reference = activeLegs.length > 0 ? JSON.stringify(Object.fromEntries(activeLegs)) : undefined;
      return { method: "split", reference };
    }
  }

  // buildMethodLabel()'s edge-case fallback: split mode selected but nothing
  // was actually charged via cash/card/upi/eWallet (e.g. a ₹0 bill).
  if (normalizedLabel === "split") {
    return { method: "split" };
  }

  // A single wallet-only leg arriving via split_details without a matching label.
  if (activeLegs.length === 1 && activeLegs[0][0].toLowerCase() === "ewallet") {
    return { method: "wallet" };
  }
  if (activeLegs.length === 1 && activeLegs[0][0].toLowerCase() in SINGLE_METHOD_MAP) {
    return { method: SINGLE_METHOD_MAP[activeLegs[0][0].toLowerCase()] };
  }

  throw new UnrecognizedPaymentMethodError(label);
}

/**
 * Package/Membership coverage, in ₹ actually offset this transaction (not a
 * boolean flag) — computed server-side by the caller from the real catalog
 * value of package-covered items / the real membership_wallet_used +
 * membership_discount_used, never trusted from the frontend's own label.
 */
export interface PaymentSourceAmounts {
  package?: number;
  membership?: number;
}

export function normalizePaymentMethod(
  label: string,
  splitDetails?: Record<string, number>,
  sourceAmounts?: PaymentSourceAmounts
): NormalizedPaymentMethod {
  const packageAmt = Number(sourceAmounts?.package) || 0;
  const membershipAmt = Number(sourceAmounts?.membership) || 0;

  if (packageAmt <= 0 && membershipAmt <= 0) {
    return resolveMoneyMethod(label, splitDetails);
  }

  // Real money actually collected this transaction (Cash/Card/UPI only —
  // eWallet is intentionally excluded from the visible legs here, same as
  // resolveMoneyMethod above: it has its own dedicated ewallet_used column
  // and was never surfaced as a payment_method leg). Read straight off
  // split_details (the real amounts charged) rather than re-deriving from
  // `label`, since a fully package/membership-covered bill can carry a
  // leftover "Cash" label from the frontend's UI default even though ₹0 was
  // actually charged via Cash — trusting the label here would wrongly turn
  // a pure Package/Membership payment into a fabricated "Package + Cash".
  const activeMoneyLegs = Object.entries(splitDetails ?? {})
    .filter(([key, amount]) => Number(amount) > 0 && key.toLowerCase() !== "ewallet");

  const legs: Record<string, number> = Object.fromEntries(activeMoneyLegs);
  if (packageAmt > 0) legs["Package"] = packageAmt;
  if (membershipAmt > 0) legs["Membership"] = membershipAmt;

  const legNames = Object.keys(legs);
  if (legNames.length === 1) {
    if (legNames[0] === "Package") return { method: "package" };
    if (legNames[0] === "Membership") return { method: "membership" };
  }

  return { method: "split", reference: JSON.stringify(legs) };
}

/**
 * Human-readable "Package + Cash" / "Membership + UPI" style label for the
 * unconstrained payments.payment_method column — mirrors normalizePaymentMethod's
 * leg computation above but spells every leg out instead of collapsing to the
 * sales_payment_method_check enum value ('split'). Returns `label` unchanged
 * when no package/membership coverage applies.
 */
export function describePaymentMethod(
  label: string,
  splitDetails?: Record<string, number>,
  sourceAmounts?: PaymentSourceAmounts
): string {
  const packageAmt = Number(sourceAmounts?.package) || 0;
  const membershipAmt = Number(sourceAmounts?.membership) || 0;
  if (packageAmt <= 0 && membershipAmt <= 0) return label;

  const legs = Object.entries(splitDetails ?? {})
    .filter(([key, amount]) => Number(amount) > 0 && key.toLowerCase() !== "ewallet")
    .map(([key]) => key);

  if (packageAmt > 0) legs.push("Package");
  if (membershipAmt > 0) legs.push("Membership");

  return legs.length > 0 ? legs.join(" + ") : label;
}
