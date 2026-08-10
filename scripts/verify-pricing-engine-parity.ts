/**
 * Characterization test for src/modules/pricing/pricing.engine.ts — asserts
 * the new shared engine reproduces payments.service.ts's pre-refactor inline
 * math exactly (byte-for-byte on every numeric field that mattered to that
 * call site: gstAmount, grandTotal, effectiveTotal), across a representative
 * set of scenarios, BEFORE trusting it as the single source of truth.
 *
 * No database access — pure function in, pure function out. Each "expected"
 * value below was hand-derived from the exact formulas that were live in
 * payments.service.ts and totalsUtils.ts prior to this refactor (transcribed
 * from the source, not re-guessed), so a mismatch here means the port
 * introduced a real behavior change, not a test bug.
 *
 * Run with: npx ts-node scripts/verify-pricing-engine-parity.ts
 */
import {
  computeBillTotals, normalizeDiscountAppliesTo, ActiveTaxRow, BucketAmounts,
} from '../src/modules/pricing/pricing.engine';

let failures = 0;

function approxEqual(a: number, b: number, label: string, epsilon = 1e-9) {
  const ok = Math.abs(a - b) < epsilon;
  console.log(`  ${label}: ${a} (expected ${b}) -> ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) failures++;
}

const zeroAmounts: BucketAmounts = { service: 0, packages: 0, product: 0, membership: 0 };

function amounts(partial: Partial<BucketAmounts>): BucketAmounts {
  return { ...zeroAmounts, ...partial };
}

// ── Scenario 1: no tax, no discount, no benefits ────────────────────────────
console.log('Scenario 1: plain ₹1000 service, no tax/discount/benefits');
{
  const r = computeBillTotals({
    actualAmounts: amounts({ service: 1000 }),
    discountType: 'flat',
    discountValue: 0,
    taxes: [],
    exCharges: 0,
    tip: 0,
    roundSubtotalBeforeDiscount: true,
  });
  approxEqual(r.gstAmount, 0, 'gstAmount');
  approxEqual(r.grandTotal, 1000, 'grandTotal');
  approxEqual(r.preRedemptionTotal, 1000, 'preRedemptionTotal');
}

// ── Scenario 2: flat discount + exclusive tax + tip + exCharges ─────────────
console.log('\nScenario 2: ₹1000 service, ₹100 flat discount, 18% exclusive GST, ₹20 ex-charge, ₹50 tip');
{
  const gst18: ActiveTaxRow = {
    tax_name: 'GST', tax_value: 18, inclusive_taxes: false,
    applicable_for: { service: true, product: true, membership: true, packages: true },
  };
  const r = computeBillTotals({
    actualAmounts: amounts({ service: 1000 }),
    discountType: 'flat',
    discountValue: 100,
    taxes: [gst18],
    exCharges: 20,
    tip: 50,
    roundSubtotalBeforeDiscount: true,
  });
  // Bill Discount is POST-tax, so it no longer shrinks the taxable base:
  // taxable = 1000, gst = 1000*0.18 = 180, billTotal = 1180.
  // grandTotal = 1180 - 100 discount + 20 exCharges = 1100 (tip never added).
  approxEqual(r.gstAmount, 180, 'gstAmount (discount is post-tax, base stays 1000)');
  approxEqual(r.grandTotal, 1100, 'grandTotal');
}

// ── Scenario 3: same as 2, plus eWallet used ────────────────────────────────
console.log('\nScenario 3: same as Scenario 2, plus ₹200 eWallet applied');
{
  const gst18: ActiveTaxRow = {
    tax_name: 'GST', tax_value: 18, inclusive_taxes: false,
    applicable_for: { service: true, product: true, membership: true, packages: true },
  };
  const r = computeBillTotals({
    actualAmounts: amounts({ service: 1000 }),
    discountType: 'flat',
    discountValue: 100,
    taxes: [gst18],
    exCharges: 20,
    tip: 50,
    eWalletUsed: 200,
    roundSubtotalBeforeDiscount: true,
  });
  // grandTotal is the fully-reduced figure now — eWallet already subtracted.
  approxEqual(r.preRedemptionTotal, 1100, 'preRedemptionTotal (before eWallet)');
  approxEqual(r.grandTotal, 900, 'grandTotal (1100 - 200 eWallet)');
}

// ── Scenario 4: inclusive tax — backed out, not added to total ─────────────
console.log('\nScenario 4: ₹1180 service with 18% INCLUSIVE GST already baked in, no discount');
{
  const gst18incl: ActiveTaxRow = {
    tax_name: 'GST', tax_value: 18, inclusive_taxes: true,
    applicable_for: { service: true, product: true, membership: true, packages: true },
  };
  const r = computeBillTotals({
    actualAmounts: amounts({ service: 1180 }),
    discountType: 'flat',
    discountValue: 0,
    taxes: [gst18incl],
    exCharges: 0,
    tip: 0,
    roundSubtotalBeforeDiscount: true,
  });
  // Inclusive tax never adds to gstAmount/grandTotal — only shown in breakdown.
  approxEqual(r.gstAmount, 0, 'gstAmount (inclusive tax adds nothing)');
  approxEqual(r.grandTotal, 1180, 'grandTotal (unchanged by inclusive tax)');
  const inclusiveEntry = r.taxBreakdown.find(t => t.inclusive);
  const expectedInclusiveAmount = (1180 * 18) / 118; // backed out of the inclusive price
  console.log(`  taxBreakdown inclusive entry present: ${!!inclusiveEntry ? 'OK' : 'FAIL'}`);
  if (!inclusiveEntry) failures++;
  else approxEqual(inclusiveEntry.amount, expectedInclusiveAmount, 'taxBreakdown inclusive amount');
}

// ── Scenario 5: membership wallet coverage excluded from taxable base ──────
console.log('\nScenario 5: ₹1000 service, ₹300 covered by membership wallet, 18% exclusive GST');
{
  const gst18: ActiveTaxRow = {
    tax_name: 'GST', tax_value: 18, inclusive_taxes: false,
    applicable_for: { service: true, product: true, membership: true, packages: true },
  };
  const r = computeBillTotals({
    actualAmounts: amounts({ service: 1000 }),
    discountType: 'flat',
    discountValue: 0,
    taxes: [gst18],
    exCharges: 0,
    tip: 0,
    membershipWalletUsed: 300,
    membershipServiceWalletUsed: 300,
    roundSubtotalBeforeDiscount: true,
  });
  // bucketTaxable = 1000 - 0(discRatio) - 300 = 700; tax = 700*0.18=126
  approxEqual(r.gstAmount, 126, 'gstAmount (wallet-covered ₹300 excluded from tax base)');
  // billTotal = 1000 + 126 = 1126; grandTotal = 1126 - 300 wallet = 826
  approxEqual(r.preRedemptionTotal, 1126, 'preRedemptionTotal (before wallet)');
  approxEqual(r.grandTotal, 826, 'grandTotal (preRedemptionTotal - membershipWalletUsed)');
}

// ── Scenario 6: multi-bucket proportional discount allocation ──────────────
console.log('\nScenario 6: ₹1000 service + ₹500 product, ₹300 flat discount, 18% GST (service only)');
{
  const gst18ServiceOnly: ActiveTaxRow = {
    tax_name: 'GST', tax_value: 18, inclusive_taxes: false,
    applicable_for: { service: true, product: false, membership: false, packages: false },
  };
  const r = computeBillTotals({
    actualAmounts: amounts({ service: 1000, product: 500 }),
    discountType: 'flat',
    discountValue: 300,
    taxes: [gst18ServiceOnly],
    exCharges: 0,
    tip: 0,
    roundSubtotalBeforeDiscount: true,
  });
  // Bill Discount is post-tax, so discRatio is 0 and the service bucket is
  // taxed on its full 1000: tax = 1000*0.18 = 180 (product bucket untaxed,
  // applicable_for.product=false).
  approxEqual(r.gstAmount, 180, 'gstAmount (only service bucket taxed)');
  // billTotal = 1500 + 180 = 1680; grandTotal = 1680 - 300 = 1380. Flat under
  // LEGACY scope stays uncapped, so all ₹300 comes off even though the legacy
  // percentage base (service+GST = 1180) excludes the ₹500 product.
  approxEqual(r.grandTotal, 1380, 'grandTotal');
}

// ── Scenario 7: legacy rounding-order quirk — proves the flag does real work ─
console.log('\nScenario 7: rawSubtotal=100.5, discount=0.5 — legacy vs frontend-style rounding disagree');
{
  const r1 = computeBillTotals({
    actualAmounts: amounts({ service: 100.5 }),
    discountType: 'flat',
    discountValue: 0.5,
    taxes: [],
    exCharges: 0,
    tip: 0,
    roundSubtotalBeforeDiscount: true, // legacy backend behavior
  });
  // Legacy: actualBill = round(100.5) = 101 (JS rounds .5 up); grandTotal = round(101-0.5) = round(100.5) = 101
  approxEqual(r1.grandTotal, 101, 'grandTotal with roundSubtotalBeforeDiscount=true (legacy backend)');

  const r2 = computeBillTotals({
    actualAmounts: amounts({ service: 100.5 }),
    discountType: 'flat',
    discountValue: 0.5,
    taxes: [],
    exCharges: 0,
    tip: 0,
    roundSubtotalBeforeDiscount: false, // frontend computeTotals behavior
  });
  // Frontend-style: taxable = 100.5-0.5 = 100; grandTotal = round(100) = 100
  approxEqual(r2.grandTotal, 100, 'grandTotal with roundSubtotalBeforeDiscount=false (frontend-style)');
  console.log(`  Confirms the two modes genuinely differ here (101 vs 100): ${r1.grandTotal !== r2.grandTotal ? 'OK' : 'FAIL — flag has no effect, investigate'}`);
  if (r1.grandTotal === r2.grandTotal) failures++;
}

// ── Scenario 8: per-row tax allocation (new `rows` input) ──────────────────
console.log('\nScenario 8: per-row tax allocation — 2 service rows (₹700+₹300) + 1 product row (₹500), ₹300 flat discount, 18% GST (service only)');
{
  const gst18ServiceOnly: ActiveTaxRow = {
    tax_name: 'GST', tax_value: 18, inclusive_taxes: false,
    applicable_for: { service: true, product: false, membership: false, packages: false },
  };
  const serviceRows = [{ price: 700, qty: 1 }, { price: 300, qty: 1 }];
  const productRows = [{ price: 500, qty: 1 }];
  const r = computeBillTotals({
    actualAmounts: amounts({ service: 1000, product: 500 }),
    discountType: 'flat',
    discountValue: 300,
    taxes: [gst18ServiceOnly],
    exCharges: 0,
    tip: 0,
    roundSubtotalBeforeDiscount: true,
    rows: { service: serviceRows, product: productRows },
  });
  // Same totals as Scenario 6 — adding `rows` must not change bucket/grand totals.
  approxEqual(r.gstAmount, 180, 'gstAmount (unchanged vs Scenario 6)');
  approxEqual(r.grandTotal, 1380, 'grandTotal (unchanged vs Scenario 6)');

  const serviceRowTax = r.rowTax?.service ?? [];
  const productRowTax = r.rowTax?.product ?? [];
  console.log(`  rowTax.service: [${serviceRowTax.join(', ')}], rowTax.product: [${productRowTax.join(', ')}]`);

  const sumAllRowTax = [...serviceRowTax, ...productRowTax].reduce((s, v) => s + v, 0);
  approxEqual(sumAllRowTax, r.gstAmount, 'sum(all rowTax) reconciles exactly to gstAmount', 1e-6);

  // Product bucket has no applicable tax → every product row's tax is 0.
  approxEqual(productRowTax[0] ?? -1, 0, 'product row tax is 0 (bucket not taxable)');

  // Service rows split 700:300 (7:3) of the bucket's ₹180 tax.
  approxEqual(serviceRowTax[0] ?? -1, 126, 'service row 1 tax (700/1000 share of 180)');
  approxEqual(serviceRowTax[1] ?? -1, 54, 'service row 2 tax (300/1000 share of 180)');
}

// ── Scenario 9: discountAppliesTo — % now reaches products when ticked ─────
// The original bug: percentage skipped products entirely while flat did not.
// These four cases pin down both halves of the fix and the legacy fallback.
console.log('\nScenario 9: ₹1000 service + ₹1000 product, 10% Bill Discount, no tax');
{
  const base = {
    actualAmounts: amounts({ service: 1000, product: 1000 }),
    discountType: 'percentage' as const,
    discountValue: 10,
    taxes: [] as ActiveTaxRow[],
    exCharges: 0,
    tip: 0,
  };

  // Legacy (undefined) — product excluded, so 10% of 1000, not of 2000.
  const legacy = computeBillTotals({ ...base });
  approxEqual(legacy.discountBase, 1000, 'legacy discountBase (service only)');
  approxEqual(legacy.manualDiscount, 100, 'legacy manualDiscount (10% of service only)');
  approxEqual(legacy.grandTotal, 1900, 'legacy grandTotal');

  // All four ticked — the whole bill is discountable, which is the fix.
  const allFour = computeBillTotals({
    ...base, discountAppliesTo: ['service', 'packages', 'product', 'membership'],
  });
  approxEqual(allFour.discountBase, 2000, 'all-four discountBase (whole bill)');
  approxEqual(allFour.manualDiscount, 200, 'all-four manualDiscount (10% of 2000)');
  approxEqual(allFour.grandTotal, 1800, 'all-four grandTotal');

  // Product only — the inverse of legacy, previously impossible to express.
  const productOnly = computeBillTotals({ ...base, discountAppliesTo: ['product'] });
  approxEqual(productOnly.discountBase, 1000, 'product-only discountBase');
  approxEqual(productOnly.manualDiscount, 100, 'product-only manualDiscount');

  // Nothing ticked — base 0, so the discount genuinely does nothing.
  const none = computeBillTotals({ ...base, discountAppliesTo: [] });
  approxEqual(none.discountBase, 0, 'empty-selection discountBase');
  approxEqual(none.manualDiscount, 0, 'empty-selection manualDiscount');
  approxEqual(none.grandTotal, 2000, 'empty-selection grandTotal (undiscounted)');
}

// ── Scenario 10: flat is capped at the selected base, legacy stays uncapped ─
// This is the %-vs-flat inconsistency itself: with Product unticked, a flat
// ₹1500 must not reach the product's value. Under legacy scope it still does,
// because that is what pre-column bills were actually charged.
console.log('\nScenario 10: ₹1000 service + ₹1000 product, ₹1500 FLAT discount, no tax');
{
  const base = {
    actualAmounts: amounts({ service: 1000, product: 1000 }),
    discountType: 'flat' as const,
    discountValue: 1500,
    taxes: [] as ActiveTaxRow[],
    exCharges: 0,
    tip: 0,
  };

  const scoped = computeBillTotals({
    ...base, discountAppliesTo: ['service', 'packages', 'membership'],
  });
  approxEqual(scoped.manualDiscount, 1000, 'flat capped at selected base (₹1000 service)');
  approxEqual(scoped.grandTotal, 1000, 'grandTotal — product untouched by the discount');

  const legacy = computeBillTotals({ ...base });
  approxEqual(legacy.manualDiscount, 1500, 'legacy flat stays UNCAPPED (the original bug, preserved)');
  approxEqual(legacy.grandTotal, 500, 'legacy grandTotal — discount bled onto the product');

  console.log(`  Confirms scoped and legacy genuinely differ (1000 vs 1500): ${scoped.manualDiscount !== legacy.manualDiscount ? 'OK' : 'FAIL — legacy gate has no effect, investigate'}`);
  if (scoped.manualDiscount === legacy.manualDiscount) failures++;
}

// ── Scenario 11: the selected buckets' own GST joins the base ──────────────
// Ticking Product has to discount the product's tax as well as its price,
// otherwise the base and the bill disagree about what "the whole bill" means.
console.log('\nScenario 11: ₹1000 service + ₹1000 product, 18% exclusive GST on both, 10% Bill Discount');
{
  const gst18: ActiveTaxRow = {
    tax_name: 'GST', tax_value: 18, inclusive_taxes: false,
    applicable_for: { service: true, product: true, membership: true, packages: true },
  };
  const base = {
    actualAmounts: amounts({ service: 1000, product: 1000 }),
    discountType: 'percentage' as const,
    discountValue: 10,
    taxes: [gst18],
    exCharges: 0,
    tip: 0,
  };

  // Service only: base = 1000 + its own 180 GST = 1180.
  const serviceOnly = computeBillTotals({ ...base, discountAppliesTo: ['service'] });
  approxEqual(serviceOnly.discountBase, 1180, 'service-only base includes only service GST');
  approxEqual(serviceOnly.manualDiscount, 118, 'service-only manualDiscount');

  // Both: base = 2000 + 360 GST = 2360.
  const both = computeBillTotals({ ...base, discountAppliesTo: ['service', 'product'] });
  approxEqual(both.discountBase, 2360, 'both-buckets base includes both buckets GST');
  approxEqual(both.manualDiscount, 236, 'both-buckets manualDiscount');
  // billTotal = 2000 + 360 = 2360, fully discountable at 10% → 2124.
  approxEqual(both.grandTotal, 2124, 'both-buckets grandTotal');
}

// ── Scenario 12: the "bill" scope — whole Total Bill, not a bucket sum ─────
// On a plain bill it must agree with all-four exactly; with a membership
// benefit in play the two deliberately diverge, which is the entire reason
// "bill" exists as its own option rather than an alias for all four.
console.log('\nScenario 12: "bill" scope vs all-four');
{
  const gst18: ActiveTaxRow = {
    tax_name: 'GST', tax_value: 18, inclusive_taxes: false,
    applicable_for: { service: true, product: true, membership: true, packages: true },
  };

  // Plain bill: no coupon, no membership benefit → identical bases.
  const plain = {
    actualAmounts: amounts({ service: 1000, product: 1000 }),
    discountType: 'percentage' as const,
    discountValue: 10,
    taxes: [gst18],
    exCharges: 0,
    tip: 0,
  };
  const plainBill = computeBillTotals({ ...plain, discountAppliesTo: ['bill'] });
  const plainAll = computeBillTotals({
    ...plain, discountAppliesTo: ['service', 'packages', 'product', 'membership'],
  });
  approxEqual(plainBill.discountBase, 2360, '"bill" base = billTotal (2000 + 360 GST)');
  approxEqual(plainBill.discountBase, plainAll.discountBase, '"bill" matches all-four on a plain bill');
  approxEqual(plainBill.grandTotal, plainAll.grandTotal, 'grandTotal matches too');

  // With ₹500 of membership wallet on the service: bucket scope nets that out
  // of its base, "bill" does not — it is the Total Bill figure as shown.
  const withWallet = {
    ...plain,
    membershipWalletUsed: 500,
    membershipServiceWalletUsed: 500,
  };
  const walletBill = computeBillTotals({ ...withWallet, discountAppliesTo: ['bill'] });
  const walletAll = computeBillTotals({
    ...withWallet, discountAppliesTo: ['service', 'packages', 'product', 'membership'],
  });
  // taxable 2000; service bucket taxed on 1000-500=500 → 90, product 1000 → 180.
  // billTotal = 2000 + 270 = 2270.
  approxEqual(walletBill.discountBase, 2270, '"bill" base stays the full Total Bill');
  // Bucket scope: (1000-500) + 1000 = 1500, plus both buckets GST 270 = 1770.
  approxEqual(walletAll.discountBase, 1770, 'all-four base nets out wallet-covered value');
  console.log(`  Confirms "bill" is not an alias for all-four (2270 vs 1770): ${walletBill.discountBase !== walletAll.discountBase ? 'OK' : 'FAIL — scopes collapsed, investigate'}`);
  if (walletBill.discountBase === walletAll.discountBase) failures++;

  // Exclusivity is enforced at normalization, not left to the engine.
  const mixed = normalizeDiscountAppliesTo(['service', 'bill', 'product']);
  console.log(`  normalizeDiscountAppliesTo(['service','bill','product']) -> [${mixed?.join(', ')}]`);
  if (mixed?.length !== 1 || mixed[0] !== 'bill') { console.log('  FAIL — "bill" did not override the bucket names'); failures++; }
}

console.log(failures === 0 ? '\n✅ All pricing engine parity checks passed.' : `\n❌ ${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
