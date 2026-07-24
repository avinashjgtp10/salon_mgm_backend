/**
 * Characterization test for pricingService.calculateTotals's INPUT-ASSEMBLY
 * logic (building the engine's ComputeBillTotalsInput from a request body).
 * The actual pricing math is already fully covered by
 * verify-pricing-engine-parity.ts — this only needs to prove the service
 * layer wires request fields into the engine correctly.
 *
 * No database access: this exercises calculateTotals() with includeGst=false
 * and no client_id/couponCode, which are the only fields that trigger a DB
 * call in the current implementation (see pricing.service.ts) — every other
 * assembly step (row totals, discount, exCharges, tip) runs unconditionally
 * and is fully exercised here. DB-dependent branches (coupon validation,
 * eWallet/points/referral/membership-wallet clamping, tax lookup) reuse
 * existing, already-live repository calls rather than new logic — verify
 * those manually via the real endpoint once a dev server + auth token is
 * available.
 *
 * Run with: npx ts-node scripts/verify-pricing-endpoint-parity.ts
 */
import { pricingService } from '../src/modules/pricing/pricing.service';

let failures = 0;

function approxEqual(a: number, b: number, label: string, epsilon = 1e-9) {
  const ok = Math.abs(a - b) < epsilon;
  console.log(`  ${label}: ${a} (expected ${b}) -> ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) failures++;
}

async function main() {
  console.log('Scenario: service ₹1000 + product ₹500, ₹150 flat discount, ₹30 ex-charge, ₹40 tip, includeGst=false, no client');
  const r = await pricingService.calculateTotals('00000000-0000-0000-0000-000000000000', {
    serviceRows: [{ price: 1000, qty: 1 }],
    packageRows: [],
    productRows: [{ price: 500, qty: 1 }],
    membershipRows: [],
    discountType: 'flat',
    discountValue: 150,
    exCharges: 30,
    tip: 40,
    includeGst: false,
  });

  // rawSubtotal = 1500; totalDisc = 150; taxable = 1350; gstAmount = 0 (includeGst=false)
  // grandTotal = round(1350 + 0 + 30 + 40) = 1420
  approxEqual(r.taxable, 1350, 'taxable');
  approxEqual(r.gstAmount, 0, 'gstAmount (includeGst=false must zero tax regardless of any configured rates)');
  approxEqual(r.grandTotal, 1420, 'grandTotal');
  approxEqual(r.effectiveTotal, 1420, 'effectiveTotal (no benefits applied)');
  approxEqual(r.appliedEWallet, 0, 'appliedEWallet (no client_id)');
  approxEqual(r.appliedMembershipWallet, 0, 'appliedMembershipWallet (no client_id)');
  approxEqual(r.appliedReferralCredit, 0, 'appliedReferralCredit');
  approxEqual(r.referralDiscountPreview, 0, 'referralDiscountPreview (no client_id)');
  console.log(`  couponRejectedReason: ${r.couponRejectedReason} (expected undefined) -> ${r.couponRejectedReason === undefined ? 'OK' : 'FAIL'}`);
  if (r.couponRejectedReason !== undefined) failures++;

  console.log('\nScenario: percentage discount base excludes products (matches totalsUtils.ts)');
  const r2 = await pricingService.calculateTotals('00000000-0000-0000-0000-000000000000', {
    serviceRows: [{ price: 1000, qty: 1 }],
    packageRows: [],
    productRows: [{ price: 1000, qty: 1 }],
    membershipRows: [],
    discountType: 'percentage',
    discountValue: 10, // 10% of (service+package+membership) = 10% of 1000 = 100, NOT 10% of 2000
    exCharges: 0,
    tip: 0,
    includeGst: false,
  });
  approxEqual(r2.manualDiscount, 100, 'manualDiscount (10% of service-bucket-only base, excludes product)');

  console.log(failures === 0 ? '\n✅ All pricing endpoint assembly checks passed.' : `\n❌ ${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
