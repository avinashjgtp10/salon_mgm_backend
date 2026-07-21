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
import { computeBillTotals, ActiveTaxRow, BucketAmounts } from '../src/modules/pricing/pricing.engine';

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
  approxEqual(r.effectiveTotal, 1000, 'effectiveTotal');
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
  // Legacy formula: actualBill=1000, discount=100, taxAmount = (1000-1000*0.1)*0.18 = 900*0.18=162
  // grandTotal = round(1000 - 100 + 162 + 20 + 50) = round(1132) = 1132
  approxEqual(r.gstAmount, 162, 'gstAmount');
  approxEqual(r.grandTotal, 1132, 'grandTotal');
  approxEqual(r.effectiveTotal, 1132, 'effectiveTotal');
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
  approxEqual(r.grandTotal, 1132, 'grandTotal');
  approxEqual(r.effectiveTotal, 932, 'effectiveTotal (1132 - 200 eWallet)');
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
  // grandTotal = round(1000 - 0 + 126 + 0 + 0) = 1126; effectiveTotal = 1126 - 300 wallet = 826
  approxEqual(r.grandTotal, 1126, 'grandTotal');
  approxEqual(r.effectiveTotal, 826, 'effectiveTotal (grandTotal - membershipWalletUsed)');
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
  // discRatio = 300/1500 = 0.2; service bucketTaxable = 1000*0.8=800; tax=800*0.18=144
  // (product bucket untaxed since applicable_for.product=false)
  approxEqual(r.gstAmount, 144, 'gstAmount (only service bucket taxed)');
  // grandTotal = round(1500 - 300 + 144) = 1344
  approxEqual(r.grandTotal, 1344, 'grandTotal');
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

console.log(failures === 0 ? '\n✅ All pricing engine parity checks passed.' : `\n❌ ${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
