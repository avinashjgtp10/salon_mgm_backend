// Single source of truth for appointment/quick-sale bill-total math — tax
// bucket allocation, discount proportioning, grand total. This is a backend
// port + superset of the frontend's src/features/bookings/utils/totalsUtils.ts
// (`computeTotals`), extended to also produce the full per-tax-name
// `taxBreakdown` and `catalogTotal`/`itemDiscountTotal` display figures that
// payments.service.ts's previous inline recompute never reconstructed (it
// only needed the net exclusive-tax add-on number, not a full breakdown).
//
// Pure function, no DB calls — callers (payments.service.ts today, a future
// preview endpoint later) fetch active taxes / resolve wallet-clamped amounts
// themselves and pass the results in, exactly like totalsUtils.ts's
// `computeTotals` takes `taxes`/`eWalletUsed`/etc. as plain inputs.

export type BucketType = "service" | "product" | "membership" | "packages";

export interface ActiveTaxRow {
  tax_name: string;
  tax_value: number;
  inclusive_taxes: boolean;
  applicable_for: {
    service: boolean;
    product: boolean;
    membership: boolean;
    packages: boolean;
  };
}

export interface TaxBreakdownEntry {
  name: string;
  rate: number;
  amount: number;
  inclusive: boolean;
}

export interface LineItem {
  price: number;
  qty: number;
  discount?: number;
  total?: number;
  // Membership-wallet-eligibility only (see pricing.service.ts's wallet split)
  // — unused by the rest of this engine, which only reads price/qty/total.
  isPackageService?: boolean;
  // This row's own share of the bucket-level membership wallet deduction —
  // only meaningful when the caller also passes `rows` (see
  // ComputeBillTotalsInput.rows) for per-row tax allocation. Excluded from
  // this row's taxable base the same way membershipServiceWalletUsed/
  // membershipProductWalletUsed are excluded at the bucket level.
  walletUsed?: number;
}

export interface BucketAmounts {
  service: number;
  packages: number;
  product: number;
  membership: number;
}

export interface ComputeBillTotalsInput {
  // Post-per-row-discount amounts per bucket (what totalsUtils.ts's
  // `rowsTotal()` produces — prefers each item's own `total` field over
  // price×qty). This is what discount/tax math operates on.
  actualAmounts: BucketAmounts;
  // Pre-per-row-discount amounts per bucket (price×qty, ignoring any stored
  // `total`) — display-only, used for `catalogTotal`/`itemDiscountTotal`.
  // Optional: omit if the caller has no need for these display figures
  // (defaults to actualAmounts, i.e. itemDiscountTotal = 0).
  catalogAmounts?: BucketAmounts;
  // Bill-level "Svc Discount" field — % applies only to service+packages+
  // membership buckets (never product), matching totalsUtils.ts exactly.
  discountType: "percentage" | "flat";
  discountValue: number;
  couponDiscount?: number;
  taxes: ActiveTaxRow[];
  exCharges: number;
  tip: number;
  eWalletUsed?: number;
  membershipWalletUsed?: number;
  // Split of membershipWalletUsed by bucket (services vs products — wallet
  // redemption never touches packages/memberships) — excluded from the
  // taxable base, same as totalsUtils.ts.
  membershipServiceWalletUsed?: number;
  membershipProductWalletUsed?: number;
  rewardPointsRedeemedValue?: number;
  referralCreditUsed?: number;
  // Reproduces a pre-existing backend-only quirk: payments.service.ts's
  // legacy inline recompute rounded the subtotal to the nearest rupee BEFORE
  // subtracting the discount to get the taxable/grandTotal base
  // (`actualBill = Math.round(rawSubtotal)`, then `actualBill - discount`),
  // while the frontend's computeTotals never rounds until the very end. The
  // two can genuinely disagree by ±1 in fractional-rupee edge cases (see
  // scripts/verify-pricing-engine-parity.ts for a concrete example). This
  // ONLY affects that one subtraction — the discount-ratio used to allocate
  // tax across buckets always uses the unrounded raw subtotal regardless of
  // this flag, matching both frontend and backend's historical behavior
  // exactly (neither ever rounded before computing that ratio). Default false
  // (frontend-matching behavior) — payments.service.ts passes true to exactly
  // reproduce its historical numeric behavior. Do not remove this without
  // deliberately deciding to unify the two roundings (a real, separate
  // behavior change, not a refactor).
  roundSubtotalBeforeDiscount?: boolean;
  // Optional: per-row breakdown of each bucket, in the SAME order the caller
  // will later map its own item list. Enables per-item tax allocation
  // (BillTotalsResult.rowTax/rowTaxableAmount) for real per-line-item GST
  // storage/reporting. Omitted by every existing caller (previews,
  // single-item purchases) -- when absent, behavior is byte-for-byte
  // identical to before this field existed.
  rows?: {
    service?: LineItem[];
    packages?: LineItem[];
    product?: LineItem[];
    membership?: LineItem[];
  };
}

export interface BillTotalsResult {
  catalogTotal: number;
  itemDiscountTotal: number;
  subtotal: number;
  manualDiscount: number;
  totalDisc: number;
  taxable: number;
  gstAmount: number;
  taxBreakdown: TaxBreakdownEntry[];
  grandTotal: number;
  roundOff: number;
  effectiveTotal: number;
  // Present only when the caller passed `ComputeBillTotalsInput.rows` --
  // each array is index-aligned with the corresponding `rows[type]` array
  // the caller supplied, so the caller matches entries back by index (no id
  // matching needed here). tax = exclusive + inclusive tax allocated to that
  // row; taxableAmount = that row's own post-discount, post-wallet base.
  rowTax?: { service: number[]; packages: number[]; product: number[]; membership: number[] };
  rowTaxableAmount?: { service: number[]; packages: number[]; product: number[]; membership: number[] };
}

export function rowsTotal(rows: LineItem[]): number {
  return rows.reduce((s, r) => s + (r.total ?? r.price * (r.qty || 1)), 0);
}

export function rowsCatalogTotal(rows: LineItem[]): number {
  return rows.reduce((s, r) => s + r.price * (r.qty || 1), 0);
}

function computeBucketTax(
  taxableBase: number,
  bucketType: BucketType,
  taxes: ActiveTaxRow[]
): { addOn: number; breakdown: TaxBreakdownEntry[] } {
  const applicable = taxes.filter((t) => t.applicable_for[bucketType] && t.tax_value > 0);
  const breakdown: TaxBreakdownEntry[] = [];
  let addOn = 0;

  const inclusiveTaxes = applicable.filter((t) => t.inclusive_taxes);
  const exclusiveTaxes = applicable.filter((t) => !t.inclusive_taxes);

  // Inclusive taxes are already baked into taxableBase — back them out
  // proportionally instead of adding on top.
  const inclusiveRateSum = inclusiveTaxes.reduce((s, t) => s + t.tax_value, 0);
  if (inclusiveRateSum > 0) {
    const inclusiveTotal = (taxableBase * inclusiveRateSum) / (100 + inclusiveRateSum);
    inclusiveTaxes.forEach((t) => {
      const amount = inclusiveTotal * (t.tax_value / inclusiveRateSum);
      breakdown.push({ name: t.tax_name, rate: t.tax_value, amount, inclusive: true });
    });
  }

  exclusiveTaxes.forEach((t) => {
    const amount = (taxableBase * t.tax_value) / 100;
    addOn += amount;
    breakdown.push({ name: t.tax_name, rate: t.tax_value, amount, inclusive: false });
  });

  return { addOn, breakdown };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// Splits a bucket's total tax (exclusive addOn + inclusive amount) across its
// own rows, proportional to each row's own taxable share -- NOT bucketTaxable
// itself, so this always reconciles exactly among the rows even if a caller's
// row list doesn't sum perfectly to the bucket aggregate. The last row
// absorbs the rounding remainder so sum(tax) === addOn + inclusiveTotal to
// the paisa (see pricing.engine.ts's ComputeBillTotalsInput.rows doc comment).
function allocateRowTax(
  rows: LineItem[],
  discRatio: number,
  addOn: number,
  inclusiveTotal: number
): { tax: number[]; taxableAmount: number[] } {
  const rawTaxable = rows.map((r) => {
    const base = r.total ?? r.price * (r.qty || 1);
    return Math.max(0, base - base * discRatio - (r.walletUsed ?? 0));
  });
  const taxableAmount = rawTaxable.map(round2);
  const sum = rawTaxable.reduce((s, v) => s + v, 0);
  const totalRowTax = addOn + inclusiveTotal;
  if (sum <= 0 || rows.length === 0) {
    return { tax: rows.map(() => 0), taxableAmount };
  }
  const tax = rawTaxable.map((v) => round2(totalRowTax * (v / sum)));
  const allocated = tax.reduce((s, v) => s + v, 0);
  tax[tax.length - 1] = round2(tax[tax.length - 1] + (totalRowTax - allocated));
  return { tax, taxableAmount };
}

function mergeBreakdown(entries: TaxBreakdownEntry[]): TaxBreakdownEntry[] {
  const byKey = new Map<string, TaxBreakdownEntry>();
  entries.forEach((e) => {
    const key = `${e.name}__${e.inclusive}`;
    const existing = byKey.get(key);
    if (existing) existing.amount += e.amount;
    else byKey.set(key, { ...e });
  });
  return Array.from(byKey.values());
}

export function computeBillTotals(input: ComputeBillTotalsInput): BillTotalsResult {
  const {
    actualAmounts, catalogAmounts = actualAmounts,
    discountType, discountValue, couponDiscount = 0, taxes,
    exCharges, tip, eWalletUsed = 0, membershipWalletUsed = 0,
    membershipServiceWalletUsed = 0, membershipProductWalletUsed = 0,
    rewardPointsRedeemedValue = 0, referralCreditUsed = 0,
    roundSubtotalBeforeDiscount = false,
    rows,
  } = input;

  const { service: serviceBase, packages: packageBase, product: productBase, membership: membershipBase } = actualAmounts;
  const rawSubtotal = serviceBase + packageBase + productBase + membershipBase;

  const catalogTotal = catalogAmounts.service + catalogAmounts.packages + catalogAmounts.product + catalogAmounts.membership;
  // Always compared against the unrounded raw subtotal — this is a display-only
  // figure with no legacy backend behavior to match (payments.service.ts never
  // computed it before this engine existed).
  const itemDiscountTotal = Math.max(0, catalogTotal - rawSubtotal);

  const serviceTotal = serviceBase + packageBase + membershipBase;
  const itemDisc =
    discountType === "percentage"
      ? (serviceTotal * discountValue) / 100
      : discountValue;

  const manualDiscount = Math.max(0, itemDisc);
  const totalDisc = manualDiscount + Math.max(0, couponDiscount);

  // Legacy backend quirk (see roundSubtotalBeforeDiscount doc comment above) —
  // ONLY this subtraction (feeding taxable/grandTotal) is affected; the
  // discount ratio just below always uses the unrounded raw subtotal.
  const subtotalForTaxable = roundSubtotalBeforeDiscount ? Math.round(rawSubtotal) : rawSubtotal;
  const taxable = Math.max(0, subtotalForTaxable - totalDisc);

  // Allocate the total discount proportionally across item types (by share of
  // subtotal) so each bucket's post-discount amount is taxed, not its raw
  // pre-discount price. Always uses the unrounded raw subtotal — matches both
  // totalsUtils.ts and payments.service.ts's historical behavior exactly.
  const discRatio = rawSubtotal > 0 ? Math.min(1, totalDisc / rawSubtotal) : 0;
  const buckets: { type: BucketType; base: number }[] = [
    { type: "service", base: serviceBase },
    { type: "packages", base: packageBase },
    { type: "product", base: productBase },
    { type: "membership", base: membershipBase },
  ];

  let gstAmount = 0;
  let allBreakdown: TaxBreakdownEntry[] = [];
  const rowTax = rows ? { service: [] as number[], packages: [] as number[], product: [] as number[], membership: [] as number[] } : undefined;
  const rowTaxableAmount = rows ? { service: [] as number[], packages: [] as number[], product: [] as number[], membership: [] as number[] } : undefined;
  buckets.forEach(({ type, base }) => {
    if (base <= 0) return;
    let bucketTaxable = base - base * discRatio;
    // Membership-wallet-covered amounts are excluded from the taxable base too
    // (not just the discount ratio above) — that portion was never actually
    // charged to the client, so it shouldn't be taxed either. Deliberately NOT
    // subtracted from `taxable`/grandTotal elsewhere — effectiveTotal below
    // already subtracts the full membershipWalletUsed once; doing it here too
    // would double-count it.
    if (type === "service") bucketTaxable -= membershipServiceWalletUsed;
    if (type === "product") bucketTaxable -= membershipProductWalletUsed;
    bucketTaxable = Math.max(0, bucketTaxable);
    const { addOn, breakdown } = computeBucketTax(bucketTaxable, type, taxes);
    gstAmount += addOn;
    allBreakdown = allBreakdown.concat(breakdown);

    if (rowTax && rowTaxableAmount) {
      const bucketRows = rows?.[type] ?? [];
      const inclusiveTotal = breakdown.filter((b) => b.inclusive).reduce((s, b) => s + b.amount, 0);
      const { tax, taxableAmount } = allocateRowTax(bucketRows, discRatio, addOn, inclusiveTotal);
      rowTax[type] = tax;
      rowTaxableAmount[type] = taxableAmount;
    }
  });

  const taxBreakdown = mergeBreakdown(allBreakdown);
  // Tip is collected from the client alongside the bill, but passed straight
  // through to staff — it must be part of what's actually charged here, even
  // though it's excluded from salon revenue further downstream (sales.total_amount).
  const rawGrandTotal = taxable + gstAmount + exCharges + tip;
  const grandTotal = Math.round(rawGrandTotal);
  const roundOff = grandTotal - rawGrandTotal;
  const effectiveTotal = Math.max(0, grandTotal - eWalletUsed - membershipWalletUsed - rewardPointsRedeemedValue - referralCreditUsed);

  return { catalogTotal, itemDiscountTotal, subtotal: rawSubtotal, manualDiscount, totalDisc, taxable, gstAmount, taxBreakdown, grandTotal, roundOff, effectiveTotal, rowTax, rowTaxableAmount };
}
