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
  // Optional service_categories id — lets a category-restricted membership
  // (wallet/discount/loyalty) filter which rows it's actually eligible to
  // cover. Unused by this engine's own tax/discount math, only by the
  // eligibility gating in pricing.service.ts/payments.service.ts.
  categoryId?: string;
  // Membership-wallet-eligibility only (see pricing.service.ts's wallet split)
  // — unused by the rest of this engine, which only reads price/qty/total.
  isPackageService?: boolean;
  // This row's own share of the bucket-level membership wallet deduction —
  // only meaningful when the caller also passes `rows` (see
  // ComputeBillTotalsInput.rows) for per-row tax allocation. Excluded from
  // this row's taxable base the same way membershipServiceWalletUsed/
  // membershipProductWalletUsed are excluded at the bucket level.
  walletUsed?: number;
  // This row's own share of a percentage/loyalty membership discount —
  // sourced from the SAME per-line, balance-capped allocation that actually
  // decided which rows got discounted (computeMembershipDiscount's per-line
  // loop / deductDiscountBalanceForBooking's per-item ledger writes), not a
  // uniform ratio. Unlike walletUsed, this also reduces taxable/grandTotal
  // (a genuine price cut), not just the taxable base — see the doc comment
  // on ComputeBillTotalsInput.membershipDiscountAmount.
  membershipDiscountUsed?: number;
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
  // Discount handed out by a percentage/loyalty membership. This is a genuine
  // price reduction, NOT a redemption like membershipWalletUsed — but unlike
  // the manual/coupon discount above, it is DELIBERATELY excluded from
  // totalDisc/discRatio. Those spread uniformly across every row in a bucket,
  // which is wrong here: the discount only ever hits specific eligible rows,
  // in a specific fill order, capped by a balance that can run out mid-bill
  // (see computeMembershipDiscount) — exactly like a wallet redemption's
  // targeting, just pre-tax instead of post-tax. So it's subtracted directly
  // from taxable/grandTotal in aggregate here, AND excluded per-row via
  // LineItem.membershipDiscountUsed / membershipServiceDiscountUsed /
  // membershipProductDiscountUsed below — mirroring the wallet's own
  // aggregate-vs-per-row split, not the discRatio mechanism. Deliberately not
  // part of the post-tax effectiveTotal subtraction; folding it into both
  // would take it off the bill twice.
  membershipDiscountAmount?: number;
  // First-bill referral welcome discount — unlike couponDiscount/
  // membershipDiscountAmount above, this is a POST-tax, POST-Svc-Discount
  // deduction (applied to the bill after GST and after the manual Svc
  // Discount, before membership wallet/eWallet/reward points). See
  // preRedemptionTotal on BillTotalsResult for exactly where this lands.
  referralDiscount?: number;
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
  // Same split, for membershipDiscountAmount — a plan's applies_to setting
  // decides whether services, products, or both are eligible; packages and
  // membership-plan-purchase rows never are.
  membershipServiceDiscountUsed?: number;
  membershipProductDiscountUsed?: number;
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
  // The fully-reduced bill total — subtotal, GST, Svc Discount, Extra
  // Charges/Tip, Referral Discount, Membership Wallet, eWallet, and Reward
  // Points have ALL already been applied by the time this is produced.
  // Rounded to the nearest whole rupee (the single rounding point in the
  // whole waterfall — see preRedemptionTotal below). This IS what used to be
  // called `effectiveTotal`/"Amount to Pay" — there is no longer a separate
  // "gross bill before redemptions" concept; callers that need one should
  // read `preRedemptionTotal` (unrounded, used for sequential-redemption
  // capping) or `displaySubtotal`/`subtotal` above (item-level, before any
  // bill-level deduction).
  grandTotal: number;
  roundOff: number;
  // Raw (unrounded) bill total after Svc Discount + Extra Charges/Tip +
  // Referral Discount, but BEFORE membership wallet/eWallet/reward points are
  // subtracted. This is the ceiling callers use to sequentially cap those
  // four redemptions (Membership → eWallet → Reward Points → Referral
  // Credit) against what's actually still owed — replaces the old pattern of
  // capping against `grandTotal`, which now already has those redemptions
  // baked in and would double-subtract if used as a ceiling. Never rounded,
  // never shown as its own Sale Summary row.
  preRedemptionTotal: number;
  // Display-only: subtotal with membership-wallet-covered amounts already
  // netted out, so a service fully paid via membership wallet reads as ₹0 in
  // the summary — matching the ₹0 the service's own row already shows —
  // instead of the summary still showing its full pre-coverage value.
  // Meaningless to also have a displayGrandTotal now that grandTotal itself
  // is the fully-reduced figure. Only meaningful when membershipWalletUsed >
  // 0; identical to subtotal otherwise.
  displaySubtotal: number;
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

export interface MembershipDiscountAllocation {
  total: number;
  /** Index-aligned 1:1 with the `amounts` input — 0 for any line the discount
   *  didn't reach (ineligible, or the balance ran dry before getting to it). */
  discounts: number[];
}

/**
 * Discount a plan grants across these line amounts — the SAME allocation
 * used everywhere a percentage/loyalty discount is calculated: the live
 * preview, the real ledger-writing deduction (client-memberships.repository.ts's
 * deductDiscountBalanceForBooking), and the per-row tax exclusion below. One
 * function, three call sites, so none of them can disagree.
 *
 * When the balance covers every line's own natural (amount × pct%) discount,
 * every line simply gets its full cut — order doesn't matter. When the
 * balance runs short, EVERY eligible line is scaled down by the SAME ratio
 * (its natural discount × balance/totalNaturalDiscount), rather than filling
 * lines in the order they happen to appear in `amounts` until the pool runs
 * dry. The caller-side convention of listing services before products (see
 * pricing.service.ts/payments.service.ts) used to mean an insufficient
 * balance would fully satisfy every service and leave products with nothing
 * (or vice versa) purely because of array position — proportional scaling
 * makes every eligible line lose the same percentage of ITS OWN discount
 * instead, regardless of type or position.
 *
 * Rounds per line rather than on the summed total, and must stay that way:
 * the real deduction writes one ledger row per line and rounds each, so
 * summing first would leave the preview and the charge disagreeing by paise.
 * Callers are responsible for pre-filtering to only eligible lines (skip
 * package-covered services; skip products unless the plan covers them) —
 * this function just allocates across whatever it's given. Pass Infinity as
 * the balance for uncapped (loyalty) plans — ratio is always 1 there, so
 * every eligible line always gets its full natural discount.
 */
export function allocateMembershipDiscount(
  amounts: number[],
  percent: number,
  balanceRemaining: number,
): MembershipDiscountAllocation {
  const pct = Math.max(0, Math.min(100, percent || 0));
  const discounts = amounts.map(() => 0);
  if (pct <= 0) return { total: 0, discounts };

  const balance = Math.max(0, balanceRemaining);
  const naturalDiscounts = amounts.map((amount) => (amount > 0 ? round2((amount * pct) / 100) : 0));
  const totalNatural = naturalDiscounts.reduce((s, v) => s + v, 0);
  if (totalNatural <= 0 || balance <= 0) return { total: 0, discounts };

  // ratio is always exactly 1 when the balance fully covers everyone (or is
  // Infinity, the uncapped loyalty case) — every line gets its own full cut,
  // byte-for-byte the same result as before this rework for that common case.
  const ratio = Math.min(1, balance / totalNatural);
  let total = 0;
  naturalDiscounts.forEach((natural, i) => {
    if (natural <= 0) return;
    const scaled = round2(natural * ratio);
    discounts[i] = scaled;
    total = round2(total + scaled);
  });
  return { total, discounts };
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

export function round2(v: number): number {
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
    return Math.max(0, base - base * discRatio - (r.walletUsed ?? 0) - (r.membershipDiscountUsed ?? 0));
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
    discountType, discountValue, couponDiscount = 0, membershipDiscountAmount = 0, referralDiscount = 0, taxes,
    // `tip` (Staff Tip) is intentionally not destructured — it's display/
    // record-only and never affects any total computed here.
    exCharges, eWalletUsed = 0, membershipWalletUsed = 0,
    membershipServiceWalletUsed = 0, membershipProductWalletUsed = 0,
    membershipServiceDiscountUsed = 0, membershipProductDiscountUsed = 0,
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

  // "Svc Discount" (discountType/discountValue) is now a POST-tax deduction —
  // applied to the bill total AFTER GST, not to the pre-tax subtotal — per the
  // discount-after-GST rework. Coupon discount (and membership discount, see
  // below) are unaffected and still reduce the taxable base as before; only
  // this one field moved. See the `manualDiscount`/`billTotal` computation
  // after the tax bucket loop below for where it actually gets applied.
  const totalDisc = Math.max(0, couponDiscount);
  const membershipDiscount = Math.max(0, membershipDiscountAmount);

  // Legacy backend quirk (see roundSubtotalBeforeDiscount doc comment above) —
  // ONLY this subtraction (feeding taxable/grandTotal) is affected; the
  // discount ratio just below always uses the unrounded raw subtotal.
  const subtotalForTaxable = roundSubtotalBeforeDiscount ? Math.round(rawSubtotal) : rawSubtotal;
  const taxable = Math.max(0, subtotalForTaxable - totalDisc - membershipDiscount);

  // Allocate the coupon discount proportionally across item types (by share of
  // subtotal) so each bucket's post-discount amount is taxed, not its raw
  // pre-discount price. Always uses the unrounded raw subtotal — matches both
  // totalsUtils.ts and payments.service.ts's historical behavior exactly.
  // Svc Discount no longer participates here (it's post-tax now); the
  // membership discount is excluded from this ratio on purpose (see above).
  const discRatio = rawSubtotal > 0 ? Math.min(1, totalDisc / rawSubtotal) : 0;

  // Safety net: membershipDiscountAmount already reduced `taxable` above, but
  // gstAmount is computed per-bucket from membershipServiceDiscountUsed/
  // membershipProductDiscountUsed below — a caller that passes the aggregate
  // without its matching bucket split would otherwise get a correctly-reduced
  // taxable paired with an INCORRECTLY full-rate gstAmount (undercounting the
  // discount's tax effect, the exact bug this whole rework exists to fix).
  // Every real caller always has the per-item breakdown in hand and should
  // always pass both — this is a fallback for whatever's left unaccounted,
  // not the primary mechanism. It spreads only across service+product (the
  // only buckets a membership discount can ever reach), proportional to their
  // share of that combined base — never packages/memberships, unlike the
  // manual-discount ratio above.
  const membershipDiscBase = serviceBase + productBase;
  const unallocatedMembershipDiscount = Math.max(
    0, membershipDiscount - membershipServiceDiscountUsed - membershipProductDiscountUsed,
  );
  const membershipDiscRatio = membershipDiscBase > 0
    ? Math.min(1, unallocatedMembershipDiscount / membershipDiscBase)
    : 0;

  const buckets: { type: BucketType; base: number }[] = [
    { type: "service", base: serviceBase },
    { type: "packages", base: packageBase },
    { type: "product", base: productBase },
    { type: "membership", base: membershipBase },
  ];

  let gstAmount = 0;
  // Exclusive-tax add-on for the service+packages+membership buckets only
  // (never product) — feeds the percentage-type Svc Discount's base below,
  // which (matching the pre-existing "never product" rule for that field)
  // needs to be a POST-tax figure now, not just the raw pre-tax bucket sum.
  // Inclusive tax is deliberately excluded here: it's already baked into the
  // bucket's own base amount (serviceTotal below), so adding it again would
  // double-count it in the discount base.
  let nonProductExclusiveGst = 0;
  let allBreakdown: TaxBreakdownEntry[] = [];
  const rowTax = rows ? { service: [] as number[], packages: [] as number[], product: [] as number[], membership: [] as number[] } : undefined;
  const rowTaxableAmount = rows ? { service: [] as number[], packages: [] as number[], product: [] as number[], membership: [] as number[] } : undefined;
  buckets.forEach(({ type, base }) => {
    if (base <= 0) return;
    let bucketTaxable = base - base * discRatio;
    // Fallback spread for any membership discount not explicitly accounted
    // per-bucket — see membershipDiscRatio's doc comment above. A no-op (0)
    // whenever the caller passes a full, precise bucket split.
    if (type === "service" || type === "product") bucketTaxable -= base * membershipDiscRatio;
    // Membership-wallet-covered amounts are excluded from the taxable base too
    // (not just the discount ratio above) — that portion was never actually
    // charged to the client, so it shouldn't be taxed either. Deliberately NOT
    // subtracted from `taxable`/grandTotal elsewhere — effectiveTotal below
    // already subtracts the full membershipWalletUsed once; doing it here too
    // would double-count it.
    if (type === "service") bucketTaxable -= membershipServiceWalletUsed;
    if (type === "product") bucketTaxable -= membershipProductWalletUsed;
    // Membership DISCOUNT-covered amounts, same reasoning — the discount
    // already came off `taxable` in aggregate above; this is the per-bucket
    // mirror of that so buckets with no discount aren't shortchanged and
    // buckets that had it aren't double-counted against the ratio.
    if (type === "service") bucketTaxable -= membershipServiceDiscountUsed;
    if (type === "product") bucketTaxable -= membershipProductDiscountUsed;
    bucketTaxable = Math.max(0, bucketTaxable);
    const { addOn, breakdown } = computeBucketTax(bucketTaxable, type, taxes);
    gstAmount += addOn;
    if (type !== "product") nonProductExclusiveGst += addOn;
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

  // "Bill Total" — subtotal (after coupon/membership discounts) plus GST,
  // BEFORE Svc Discount. Svc Discount is a bill-level deduction applied here,
  // after tax, instead of reducing the pre-tax taxable base like coupon/
  // membership discount still do above.
  const billTotal = taxable + gstAmount;
  // Percentage type still applies only to service+packages+membership (never
  // product), matching the pre-existing rule — against their POST-tax value
  // (their bucket sum plus their own share of exclusive GST), with whatever
  // membership wallet/discount already covered on those SAME rows netted out
  // first — otherwise a row already paid off by a membership benefit still
  // inflates the % base for a discount that has nothing left to reduce there.
  const serviceTotal = (serviceBase - membershipServiceWalletUsed - membershipServiceDiscountUsed)
    + packageBase + membershipBase;
  const svcDiscountBase = serviceTotal + nonProductExclusiveGst;
  const itemDisc =
    discountType === "percentage"
      ? (svcDiscountBase * discountValue) / 100
      : discountValue;
  const manualDiscount = Math.max(0, itemDisc);

  const afterSvcDiscount = Math.max(0, billTotal - manualDiscount);
  // Extra Charges are excluded from the Svc/Bill Discount base above (see
  // billTotal) — added here, after the discount, not before. `tip` is
  // deliberately NOT added — Staff Tip is a display-only, record-only figure
  // (shown as its own Sale Summary row) that is never collected as part of
  // the bill and never affects Grand Total, matching sales.total_amount
  // (revenue) which already excludes it downstream — see sales.repository.ts.
  const withCharges = afterSvcDiscount + exCharges;

  // Referral Discount (first-bill welcome discount) is a POST-tax,
  // POST-Svc-Discount deduction — applied here, not folded into the pre-tax
  // coupon/membership discounts above.
  const referralDisc = Math.max(0, referralDiscount);
  // Raw (unrounded) ceiling for the sequential Membership Wallet → eWallet →
  // Reward Points → Referral Credit capping done by callers — see
  // BillTotalsResult.preRedemptionTotal doc comment. Never rounded, never
  // shown as its own Sale Summary row.
  const preRedemptionTotal = Math.max(0, withCharges - referralDisc);

  // Every remaining deduction (membership wallet, eWallet, reward points)
  // happens here, still in raw/unrounded form — rounding happens exactly
  // once, at the very end, not partway through.
  const rawFinalTotal = Math.max(0, preRedemptionTotal
    - membershipWalletUsed - eWalletUsed - rewardPointsRedeemedValue - referralCreditUsed);
  const grandTotal = Math.round(rawFinalTotal);
  const roundOff = grandTotal - rawFinalTotal;

  // Display-only — see BillTotalsResult.displaySubtotal doc comment. Never
  // used for grandTotal/revenue/tax above, which already subtract
  // membershipWalletUsed exactly once (in rawFinalTotal); this is a separate,
  // parallel figure purely for the Subtotal display row.
  const displaySubtotal = Math.max(0, rawSubtotal - membershipWalletUsed);

  return {
    catalogTotal, itemDiscountTotal, subtotal: rawSubtotal, manualDiscount, totalDisc: manualDiscount + totalDisc,
    taxable, gstAmount, taxBreakdown, grandTotal, roundOff, preRedemptionTotal, displaySubtotal,
    rowTax, rowTaxableAmount,
  };
}
