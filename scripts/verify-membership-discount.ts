/**
 * Verifies the membership discount is treated as a PRE-TAX price reduction —
 * i.e. GST is charged on the discounted amount, not the full one — that the
 * discount pool depletes by the discount given rather than the service price,
 * and — the point of this pass — that the discount is excluded from each
 * row's OWN taxable base individually (like the wallet's per-row exclusion),
 * not spread as a uniform ratio across every row in the bucket regardless of
 * whether that specific row was actually discounted.
 *
 * Pure math against pricing.engine.ts. No DB, no server: run with
 *   npx ts-node scripts/verify-membership-discount.ts
 */
import {
  computeBillTotals,
  allocateMembershipDiscount,
  type ActiveTaxRow,
} from '../src/modules/pricing/pricing.engine';

let failures = 0;

function check(label: string, actual: number, expected: number) {
  const ok = Math.abs(actual - expected) < 0.005;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${actual}, expected ${expected}`);
}

const gst18: ActiveTaxRow[] = [{
  tax_name: 'GST', tax_value: 18, inclusive_taxes: false,
  applicable_for: { service: true, product: true, packages: true, membership: true },
}];

const noTax: ActiveTaxRow[] = [];

// ── 1. GST is charged on the discounted amount ────────────────────────────
// ₹1,000 service, 20% membership discount, 18% GST.
// Taxable must be ₹800 and GST ₹144 — NOT ₹180 on the undiscounted ₹1,000.
//
// membershipDiscountAmount and membershipServiceDiscountUsed/
// membershipProductDiscountUsed MUST always be passed together — exactly the
// same pairing membershipWalletUsed already requires with
// membershipServiceWalletUsed/membershipProductWalletUsed. `taxable` reduces
// from the aggregate figure alone, but `gstAmount` is computed from the
// bucket-level carve-out, so a caller that passes only the aggregate gets a
// correctly-reduced taxable with an INCORRECTLY full-rate gstAmount. Real
// callers (pricing.service.ts, payments.service.ts) always have the per-item
// breakdown in hand by the time they call this, so they always pass both.
{
  const { total: discount } = allocateMembershipDiscount([1000], 20, 5000);
  check('20% of ₹1000 discount', discount, 200);

  const t = computeBillTotals({
    actualAmounts: { service: 1000, packages: 0, product: 0, membership: 0 },
    discountType: 'flat', discountValue: 0,
    membershipDiscountAmount: discount,
    membershipServiceDiscountUsed: discount,
    taxes: gst18, exCharges: 0, tip: 0,
  });
  check('taxable base', t.taxable, 800);
  check('GST on discounted amount', t.gstAmount, 144);
  check('grand total', t.grandTotal, 944);
}

// ── 2. Pool depletes by discount GIVEN, per the spec's worked example ─────
// ₹5,000 balance, 20% off: ₹1,000 haircut → ₹4,800 left; ₹2,000 facial → ₹4,400.
{
  let balance = 5000;
  const haircut = allocateMembershipDiscount([1000], 20, balance).total;
  balance = balance - haircut;
  check('after ₹1000 haircut, discount', haircut, 200);
  check('after ₹1000 haircut, balance', balance, 4800);

  const facial = allocateMembershipDiscount([2000], 20, balance).total;
  balance = balance - facial;
  check('after ₹2000 facial, discount', facial, 400);
  check('after ₹2000 facial, balance', balance, 4400);
}

// ── 3. A nearly-empty pool caps the discount ──────────────────────────────
{
  const { total: discount } = allocateMembershipDiscount([1000], 20, 50);
  check('discount capped by remaining pool', discount, 50);
}

// ── 4. Package-covered / ineligible rows are excluded by passing amount 0 ──
// (eligibility filtering is now the caller's job — pricing.service.ts and
// payments.service.ts both zero out package-covered service rows and
// not-covered product rows before calling, so they're skipped here exactly
// like a non-positive amount always is.)
{
  const { total, discounts } = allocateMembershipDiscount([1000, 0], 20, 5000);
  check('ineligible (zeroed) row total', total, 200);
  check('ineligible row gets nothing', discounts[1], 0);
  check('eligible row gets its full share', discounts[0], 200);
}

// ── 5. Per-line rounding matches the ledger's, not a summed base ──────────
// Two ₹333.33 lines at 20%: per-line gives 66.67 x2 = 133.34, whereas rounding
// a summed ₹666.66 base would give 133.33. The deduction writes one ledger row
// per line, so the per-line figure is the one that must win.
{
  const { total } = allocateMembershipDiscount([333.33, 333.33], 20, 5000);
  check('per-line rounding', total, 133.34);
}

// ── 6. Membership discount stacks with a manual discount, both pre-tax ────
{
  const t = computeBillTotals({
    actualAmounts: { service: 1000, packages: 0, product: 0, membership: 0 },
    discountType: 'flat', discountValue: 100,
    membershipDiscountAmount: 200,
    taxes: gst18, exCharges: 0, tip: 0,
  });
  check('taxable after both discounts', t.taxable, 700);
  check('GST after both discounts', t.gstAmount, 126);
}

// ── 7. Wallet stays post-tax; discount stays pre-tax ──────────────────────
// The wallet must NOT reduce `taxable`, while the discount must.
{
  const wallet = computeBillTotals({
    actualAmounts: { service: 1000, packages: 0, product: 0, membership: 0 },
    discountType: 'flat', discountValue: 0,
    membershipWalletUsed: 200, membershipServiceWalletUsed: 200,
    taxes: noTax, exCharges: 0, tip: 0,
  });
  check('wallet leaves taxable at full amount', wallet.taxable, 1000);
  check('wallet reduces only effectiveTotal', wallet.effectiveTotal, 800);

  const disc = computeBillTotals({
    actualAmounts: { service: 1000, packages: 0, product: 0, membership: 0 },
    discountType: 'flat', discountValue: 0,
    membershipDiscountAmount: 200,
    taxes: noTax, exCharges: 0, tip: 0,
  });
  check('discount reduces taxable', disc.taxable, 800);
  check('discount reduces grand total', disc.grandTotal, 800);
}

// ── 8. THE CORE FIX: per-row precision, not a uniform ratio ───────────────
// Two ₹1,000 services, 20% off, but only a ₹150 discount balance left — it
// covers ONLY the first row (₹150, capped) and the second row gets NOTHING.
// A uniform discRatio approach would (wrongly) spread ~7.5% off BOTH rows.
// The correct per-row behavior: row 0's own taxable drops by exactly ₹150;
// row 1's taxable is completely untouched.
{
  const balance = 150;
  const { discounts } = allocateMembershipDiscount([1000, 1000], 20, balance);
  check('row 0 gets the capped discount', discounts[0], 150);
  check('row 1 gets nothing (balance exhausted)', discounts[1], 0);

  const t = computeBillTotals({
    actualAmounts: { service: 2000, packages: 0, product: 0, membership: 0 },
    discountType: 'flat', discountValue: 0,
    membershipDiscountAmount: discounts[0] + discounts[1],
    membershipServiceDiscountUsed: discounts[0] + discounts[1],
    taxes: gst18, exCharges: 0, tip: 0,
    rows: {
      service: [
        { price: 1000, qty: 1, total: 1000, membershipDiscountUsed: discounts[0] },
        { price: 1000, qty: 1, total: 1000, membershipDiscountUsed: discounts[1] },
      ],
      packages: [], product: [], membership: [],
    },
  });
  // Aggregate: taxable = 2000 - 150 = 1850, GST = 333.
  check('aggregate taxable reflects only the real ₹150 discount', t.taxable, 1850);
  check('aggregate GST', t.gstAmount, 333);
  // Per-row: row 0's own taxable is 850 (1000 - 150); row 1's is untouched at 1000.
  check('row 0 taxable reduced by its own discount', t.rowTaxableAmount!.service[0], 850);
  check('row 1 taxable is UNTOUCHED — no ratio bleed-through', t.rowTaxableAmount!.service[1], 1000);
  // Per-row tax must sum to the aggregate GST, row 0 taxed less than row 1.
  const rowTaxSum = t.rowTax!.service[0] + t.rowTax!.service[1];
  check('per-row GST sums to aggregate GST', rowTaxSum, 333);
  console.log(`      (row 0 tax: ${t.rowTax!.service[0]}, row 1 tax: ${t.rowTax!.service[1]} — row 1 must be higher)`);
  if (t.rowTax!.service[1] <= t.rowTax!.service[0]) {
    failures++;
    console.log('FAIL  row 1 (undiscounted, full ₹1000) must carry MORE tax than row 0 (discounted to ₹850)');
  } else {
    console.log('PASS  row 1 correctly carries more tax than the discounted row 0');
  }
}

// ── 9. A product row outside the discount's reach keeps its own full tax ──
// Percentage plan does NOT cover products: a service row gets discounted, an
// unrelated product row must show zero membershipDiscountUsed and full tax.
{
  const t = computeBillTotals({
    actualAmounts: { service: 1000, packages: 0, product: 500, membership: 0 },
    discountType: 'flat', discountValue: 0,
    membershipDiscountAmount: 200,
    membershipServiceDiscountUsed: 200,
    membershipProductDiscountUsed: 0,
    taxes: gst18, exCharges: 0, tip: 0,
    rows: {
      service: [{ price: 1000, qty: 1, total: 1000, membershipDiscountUsed: 200 }],
      product: [{ price: 500, qty: 1, total: 500 }],
      packages: [], membership: [],
    },
  });
  check('discounted service row taxable', t.rowTaxableAmount!.service[0], 800);
  check('untouched product row keeps full taxable', t.rowTaxableAmount!.product[0], 500);
}

// ── 10. Safety net: aggregate-only call (no bucket split) still taxes right ─
// A caller that forgets to pass membershipServiceDiscountUsed/
// membershipProductDiscountUsed must NOT silently overcharge GST — the engine
// falls back to spreading the unaccounted amount across service+product only
// (never packages/memberships, unlike the manual-discount ratio).
{
  const t = computeBillTotals({
    actualAmounts: { service: 1000, packages: 0, product: 0, membership: 0 },
    discountType: 'flat', discountValue: 0,
    membershipDiscountAmount: 200, // no membershipServiceDiscountUsed passed
    taxes: gst18, exCharges: 0, tip: 0,
  });
  check('fallback still taxes the discounted amount correctly', t.gstAmount, 144);
  check('fallback grand total matches the precise-call result', t.grandTotal, 944);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
