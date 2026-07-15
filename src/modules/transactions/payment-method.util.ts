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
 * paymentUtils.ts — a small, enumerable set: "Cash" | "Card" | "UPI",
 * any "+"-joined combination of those three, or "eWallet") to the real
 * sales_payment_method_check constraint values. Never lets an unrecognized
 * raw label reach the INSERT — that's what silently broke sale creation
 * for composite labels before this module existed.
 */
export function normalizePaymentMethod(
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
