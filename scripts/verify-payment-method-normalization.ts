/**
 * Verifies normalizePaymentMethod() against every real label the frontend can
 * produce (see buildMethodLabel() in salon_mgm_frontend/paymentUtils.ts) plus
 * the constraint values it must land on (sales_payment_method_check).
 * Run with:  npx ts-node scripts/verify-payment-method-normalization.ts
 */
import { normalizePaymentMethod } from "../src/modules/transactions/payment-method.util";

type Case = {
  label: string;
  splitDetails?: Record<string, number>;
  expectMethod: string;
  expectThrow?: boolean;
};

const cases: Case[] = [
  { label: "Cash", expectMethod: "cash" },
  { label: "Card", expectMethod: "card" },
  { label: "UPI", expectMethod: "upi" },
  { label: "cash", expectMethod: "cash" },
  { label: "Cash+Card", splitDetails: { Cash: 200, Card: 300 }, expectMethod: "split" },
  { label: "Cash+UPI", splitDetails: { Cash: 100, UPI: 150 }, expectMethod: "split" },
  { label: "Card+UPI", splitDetails: { Card: 100, UPI: 150 }, expectMethod: "split" },
  { label: "Cash+Card+UPI", splitDetails: { Cash: 50, Card: 50, UPI: 50 }, expectMethod: "split" },
  { label: "eWallet", splitDetails: { eWallet: 500 }, expectMethod: "wallet" },
  { label: "eWallet", expectMethod: "wallet" },
  { label: "Split", expectMethod: "split" },
  // split_details with an eWallet leg alongside a single cash/card/upi leg —
  // buildMethodLabel() strips eWallet out of the label in this case (only
  // "Cash", not "Cash+eWallet"), so the label alone should still resolve.
  { label: "Cash", splitDetails: { Cash: 300, eWallet: 200 }, expectMethod: "cash" },
  { label: "gift_card", expectMethod: "gift_card" },
  { label: "", expectThrow: true, expectMethod: "" },
  { label: "Bitcoin", expectThrow: true, expectMethod: "" },
];

let failures = 0;
for (const c of cases) {
  try {
    const result = normalizePaymentMethod(c.label, c.splitDetails);
    if (c.expectThrow) {
      console.error(`FAIL: expected throw for label="${c.label}" but got method="${result.method}"`);
      failures++;
    } else if (result.method !== c.expectMethod) {
      console.error(`FAIL: label="${c.label}" splitDetails=${JSON.stringify(c.splitDetails)} -> expected "${c.expectMethod}", got "${result.method}"`);
      failures++;
    } else {
      console.log(`OK: label="${c.label}" splitDetails=${JSON.stringify(c.splitDetails ?? {})} -> ${result.method}${result.reference ? " ref=" + result.reference : ""}`);
    }
  } catch (err: any) {
    if (c.expectThrow) {
      console.log(`OK: label="${c.label}" correctly threw: ${err.message}`);
    } else {
      console.error(`FAIL: label="${c.label}" unexpectedly threw: ${err.message}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} case(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\nAll ${cases.length} cases passed`);
}
