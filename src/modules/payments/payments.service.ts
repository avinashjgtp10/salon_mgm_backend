import { paymentsRepository } from './payments.repository';
import { couponsRepository } from '../coupons/coupons.repository';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { recordTransaction } from '../transactions/transaction-recorder.service';
import { describePaymentMethod } from '../transactions/payment-method.util';
import { membershipsRepository } from '../memberships/memberships.repository';
import { clientMembershipsService } from '../client-memberships/client-memberships.service';
import { clientMembershipsRepository } from '../client-memberships/client-memberships.repository';
import { packageTemplatesRepository } from '../package-templates/package-templates.repository';
import { packagesRepository } from '../packages/packages.repository';
import { clientPackagesService } from '../client-packages/client-packages.service';
import { servicesRepository } from '../services/services.repository';
import { rewardPointsRepository } from '../reward-points/reward-points.repository';
import { ewalletRepository } from '../ewallet/ewallet.repository';
import { referralRepository } from '../referral/referral.repository';
import { CreatePaymentBody, Payment } from './payments.types';
import type { Appointment, AppointmentServiceConsumableRecord } from '../appointments/appointments.types';
import { appointmentConsumablesService } from '../inventory/inventory.service';
import logger from '../../config/logger';
import { sendPurchaseReceipt } from '../sales/receipt-send.helper';
import { whatsappAutomationService } from '../whatsapp-automation/whatsapp-automation.service';
import { whatsappAutomationRepository } from '../whatsapp-automation/whatsapp-automation.repository';
import { salonsRepository } from '../salons/salons.repository';
import { clientsRepository } from '../clients/clients.repository';
import { getIO } from '../../config/socket';
import { getActiveTaxes } from '../settings/tax.util';
import { computeBillTotals, allocateMembershipDiscount } from '../pricing/pricing.engine';
import pool from '../../config/database';

interface DiscountEligibleItem {
  itemId?: string;
  name?: string;
  /** Post-per-row-discount line total the percentage applies to. */
  amount: number;
  isPackageService: boolean;
  categoryId?: string;
}

// Optional narrowing of appliesTo to specific categories — empty/undefined
// means unrestricted, preserving today's behavior for every plan that
// doesn't use this feature. itemIds is a further, additive narrowing to
// specific services/products — a row matches if EITHER its category is in
// categoryIds OR its own id is in itemIds; only jointly empty means
// unrestricted.
function matchesCategoryRestriction(item: DiscountEligibleItem, categoryIds: string[] | undefined, itemIds: string[] | undefined = []): boolean {
  if (!categoryIds?.length && !itemIds?.length) return true;
  return (!!categoryIds?.length && !!item.categoryId && categoryIds.includes(item.categoryId))
      || (!!itemIds?.length && !!item.itemId && itemIds.includes(item.itemId));
}

interface MembershipDiscountResult {
  total: number;
  /** Keyed by itemId (service_id or product_id) — lets the tax engine exclude
   *  each row's OWN discount from its taxable base, not a uniform ratio. */
  perItem: Map<string, number>;
}

// Money is stored as NUMERIC(10,2); percentages of arbitrary line amounts
// routinely produce more precision than that, so every accumulation step is
// rounded to keep the total exactly reconstructable from its per-item parts.
const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Grants — and, for the percentage type, actually spends — a membership
 * discount for this appointment, returning both the total and a per-item
 * breakdown of exactly which rows it landed on.
 *
 * Discount Balance and Loyalty are independently toggled by staff (the
 * `applyPercentage`/`applyLoyalty` flags) and stack additively when both are
 * on — each source computes its own % off the SAME pre-discount line amount
 * (e.g. 30% + 10% = 40% off), rather than one compounding on top of the
 * other's already-reduced price. Loyalty writes no ledger row because it has
 * no balance to spend and no client_memberships row to attach one to — it is
 * recomputed deterministically from the same rows on every call instead.
 */
async function applyMembershipDiscountForBooking(
  salonId: string,
  clientId: string,
  appointmentId: string,
  serviceItems: DiscountEligibleItem[],
  productItems: DiscountEligibleItem[],
  applyPercentage: boolean,
  applyLoyalty: boolean,
): Promise<MembershipDiscountResult> {
  let total = 0;
  const perItem = new Map<string, number>();
  const addDiscount = (itemId: string, amount: number) => {
    perItem.set(itemId, round2((perItem.get(itemId) ?? 0) + amount));
  };

  if (applyPercentage) {
    const percentageMembership = await clientMembershipsRepository.findActivePercentageForClient(clientId, salonId);
    if (percentageMembership) {
      const appliesTo = percentageMembership.appliesTo;
      const eligible = [
        ...(appliesTo !== 'products' ? serviceItems.filter((i) => !i.isPackageService && i.amount > 0 && matchesCategoryRestriction(i, percentageMembership.serviceCategoryIds, percentageMembership.serviceIds)) : []),
        ...(appliesTo !== 'services' ? productItems.filter((i) => i.amount > 0 && matchesCategoryRestriction(i, percentageMembership.productCategoryIds, percentageMembership.productIds)) : []),
      ];
      if (eligible.length) {
        const result = await clientMembershipsRepository.deductDiscountBalanceForBooking(
          percentageMembership.id,
          salonId,
          {
            appointmentId,
            discountPercent: percentageMembership.discountPercent ?? 0,
            services: eligible.map((i) => ({ serviceId: i.itemId, serviceName: i.name, amount: i.amount })),
          },
        );
        total += result.totalDiscountGiven;
        result.perService.forEach((r) => { if (r.serviceId) addDiscount(String(r.serviceId), r.discountGiven); });
      }
    }
  }

  if (applyLoyalty) {
    const loyalty = await membershipsRepository.findLoyaltyEligibility(clientId, salonId);
    if (loyalty?.eligible) {
      const eligible = [
        ...(loyalty.appliesTo !== 'products' ? serviceItems.filter((i) => !i.isPackageService && i.amount > 0 && matchesCategoryRestriction(i, loyalty.serviceCategoryIds, loyalty.serviceIds)) : []),
        ...(loyalty.appliesTo !== 'services' ? productItems.filter((i) => i.amount > 0 && matchesCategoryRestriction(i, loyalty.productCategoryIds, loyalty.productIds)) : []),
      ];
      const { total: loyaltyTotal, discounts } = allocateMembershipDiscount(eligible.map((i) => i.amount), loyalty.discountPercent, Infinity);
      total += loyaltyTotal;
      eligible.forEach((item, i) => { if (item.itemId && discounts[i] > 0) addDiscount(String(item.itemId), discounts[i]); });
    }
  }

  return { total: round2(total), perItem };
}

export const paymentsService = {

  async create(data: CreatePaymentBody, requesterUserId?: string): Promise<Payment> {
    // ── Recompute financial fields from real appointment data ─────────────────
    // This prevents bugs where the frontend sends a wrong gross_amount
    // (e.g., partial-payment amount instead of the full bill total).
    let appt: Appointment | null = null;
    let ewalletUsedActual = 0;
    let refereeWalletCredit = 0;
    // Hoisted so the post-payment 'redeem' ledger-write block (mirroring the
    // existing eWallet redeem block) can read the actual amounts redeemed.
    let rewardPointsRedeemedActual = 0;
    let referralCreditUsedActual = 0;
    // Hoisted out of the inner `if` block below (where it's computed) so the
    // sale-creation call further down can actually read it — previously it
    // went out of scope before reaching there, which is why sales.total_amount
    // never included tax even though payments.net_amount always did.
    let taxAmount = 0;
    // Same hoisting for ex_charges/tip — appt.ex_charges/appt.tip_amount used
    // to never be read anywhere in this recompute at all (not just scoping),
    // so a client-facing surcharge or tip never actually became part of what
    // was owed/collected. ex_charges counts as salon revenue; tip does not —
    // it passes straight through to staff (see recordTransaction() call below).
    let exChargesAmt = 0;
    let tipAmt = 0;
    // "Add Tip to Salon" — checked: tip counts toward Grand Total/revenue
    // (see computeBillTotals calls + recordTransaction() below); unchecked
    // (default): tip stays record-only, same as it's always behaved.
    let tipAddedToSalon = false;
    // Optional per-staff split of tipAmt — pure attribution, never affects
    // any of the totals below (see recordTransaction() call further down).
    let tipBreakdown: any[] | null | undefined;
    // Bill's overall taxable base — only needed as a fallback for the
    // items.length===0 case below (a single synthetic item stands in for the
    // whole bill, so its own taxable_amount is just the bill's taxable total).
    let taxableAmount = 0;
    // Per-row GST, index-aligned with the `items` array built further down
    // (both derived from appt.services/package_items/product_items/
    // membership_items, in the same order) — populated by the
    // computeBillTotals() call below when it succeeds, left undefined
    // (falls back to 0 per item) if that call throws.
    let rowTaxByBucket: { service: number[]; packages: number[]; product: number[]; membership: number[] } | undefined;
    let rowTaxableByBucket: { service: number[]; packages: number[]; product: number[]; membership: number[] } | undefined;
    // Hoisted for the visit-counter block after the payment row exists. A visit
    // must be counted once per appointment, so a partial payment followed by a
    // completing one may only ever increment on the first of the two.
    let isFirstPaymentForAppointment = false;

    const isPackagePayment = (data.payment_method || '').toLowerCase() === 'package';

    if (data.appointment_id && !isPackagePayment) {
      try {
        appt = await appointmentsRepository.findById(data.appointment_id);
        if (appt) {
          // Use Number() guards — JSONB prices can arrive as strings or be undefined
          const qty = (i: any) => Number(i.qty) || Number(i.quantity) || 1;
          // Prefer each item's own `total` (set by the frontend's per-row "Disc %"
          // field — see ServiceRow.tsx calcTotal()) over price × qty, which is the
          // undiscounted unit price. Packages/products/memberships never send a
          // `total` field (no per-row discount UI for them), so they always fall
          // through to price × qty unchanged. Without this, any per-row service
          // discount was silently dropped here, inflating actualBill/net_amount
          // above what the client was actually charged — the gap then showed up
          // as a phantom due_amount equal to the discount.
          const lineTotal = (i: any) => {
            const t = Number(i.total);
            return (i.total !== undefined && i.total !== null && isFinite(t)) ? t : (Number(i.price) || 0) * qty(i);
          };
          // Package-covered rows are excluded from the billable service total:
          // the customer already paid for those sessions when they bought the
          // package, so the value must not be billed again NOR taxed. Doing it
          // here (rather than subtracting a package term further down) keeps
          // the exclusion pre-tax automatically and applies to both the
          // computeBillTotals path and the fallback formula below — the same
          // treatment membership_discount_used gets.
          const serviceTotal    = (appt.services         || [])
            .filter((i: any) => !i.is_package_service)
            .reduce((s, i) => s + lineTotal(i), 0);
          const packageTotal    = (appt.package_items    || []).reduce((s, i) => s + lineTotal(i), 0);
          const productTotal    = (appt.product_items    || []).reduce((s, i) => s + lineTotal(i), 0);
          const membershipTotal = (appt.membership_items || []).reduce((s, i) => s + lineTotal(i), 0);
          const rawSubtotal     = serviceTotal + packageTotal + productTotal + membershipTotal;
          // ₹ of this bill covered by an already-purchased Package's included
          // sessions. Hoisted onto `data` below so the recordTransaction call
          // further down (outside this try block's scope) can read it.
          //
          // Uses price×qty, NOT lineTotal: row.total was assumed to net to 0
          // on package rows, but real stored appointments have total = the
          // full price (e.g. {"price":500,"total":500,"is_package_service":
          // true}). Going through lineTotal here therefore computed the
          // coverage correctly by luck, while rawSubtotal above ALSO counted
          // that same ₹500 as billable — which is the bug this fixes. Reading
          // price×qty directly is correct regardless of what `total` holds.
          data.package_covered_amount = (appt.services || [])
            .filter((i: any) => !!i.is_package_service)
            .reduce((s, i) => s + (Number(i.price) || 0) * qty(i), 0);
          // The same figure, but this one is the money: persisted to
          // payments.package_used and removed from the taxable base below.
          //
          // Deliberately NOT cross-checked against client_package_session_history,
          // even though a bill can reach here with the flag missing from the
          // jsonb: that table cannot supply the billed amount. Its joinable
          // price is client_package_services.price — the package's per-session
          // price, not this bill's line total (INV-00157: history says ₹1000,
          // the service was billed ₹500). It also carries genuine duplicate
          // rows (INV-00156 has the same session_no twice), so any SUM over it
          // double-counts. Using it would trade a known under-count for silent
          // wrong money, which is worse. is_package_service on the appointment
          // row is the only source that states what THIS bill covered.
          data.package_used = data.package_covered_amount;
          // Rounded to the nearest whole rupee — matches computeTotals() on the
          // frontend (totalsUtils.ts), which is what the client actually sees/
          // pays. Rounding here (not after discount/wallet deductions) keeps
          // gross_amount consistent with the frontend's rounded grandTotal.
          const actualBill      = Math.round(rawSubtotal);

          // If the appointment has no priced items, fall through to frontend values
          if (!isFinite(actualBill) || actualBill <= 0) throw new Error('no_priced_items');

          // discount_amount arrives as manual Svc Discount + coupon COMBINED
          // (see usePayment.ts's payloadDiscount) — but they need to travel
          // through computeBillTotals on different channels now: coupon stays
          // pre-tax, Svc Discount is post-tax. manual_discount_amount (when
          // sent) isolates the manual-only portion; the rest is coupon.
          // Falling back to treating the whole combined figure as manual
          // (coupon = 0) preserves today's behavior for any caller that
          // hasn't been updated to send the new field yet.
          const combinedFrontendDiscount = Math.max(0, Number(data.discount_amount) || 0);
          const frontendManualDiscount = data.manual_discount_amount != null
            ? Math.max(0, Number(data.manual_discount_amount) || 0)
            : combinedFrontendDiscount;
          const frontendCouponDiscount = Math.max(0, combinedFrontendDiscount - frontendManualDiscount);
          // Hoisted onto `data` so the recordTransaction call further down
          // (a separate try block, out of this scope) can read the
          // server-resolved manual/coupon split — see package_covered_amount
          // just above for the same pattern.
          data.manual_discount_amount = frontendManualDiscount;
          data.coupon_discount_amount = frontendCouponDiscount;
          // Resolved server-side by looking up the real coupon by code —
          // never trusted from the frontend — so Sale Details/reports can
          // show which coupon (and its id/discount type) actually applied,
          // not just re-derive it from whatever the coupon looks like NOW
          // (which can drift if it's later edited/deleted).
          if (data.coupon_code && frontendCouponDiscount > 0) {
            try {
              const coupon = await couponsRepository.findByCodeForSalon(data.coupon_code, data.salon_id);
              if (coupon) {
                data.coupon_id = coupon.id;
                data.coupon_discount_type = coupon.type;
              }
            } catch (err: any) {
              logger.warn('[payments] coupon lookup for persistence failed:', err?.message ?? err);
            }
          }
          const ewalletRequested = Math.max(0, Number(data.ewallet_used)    || 0);

          // Sum previously paid amounts across all prior payments for this appointment.
          // Computed early — the referral discount below must only ever apply on the
          // FIRST payment attempt for an appointment, never re-applied on a second
          // (e.g. completing) call for the same bill.
          const existingPaid = await paymentsRepository.getTotalPaidForAppointment(data.appointment_id);
          isFirstPaymentForAppointment = existingPaid === 0;

          // ── Refer & Earn: welcome reward for the referred client's first
          // qualifying bill ────────────────────────────────────────────────────
          // If the bill meets min_bill_amount, applied immediately as a price
          // reduction on this bill (like a coupon). If it doesn't, the reward
          // isn't forfeited — it's credited straight to the client's eWallet
          // instead, so a small first visit doesn't cost them the reward.
          // Gated on referral_referee_rewarded (not referral_reward_status,
          // which tracks the REFERRER's separate payout) so this can only ever
          // fire once per referred client, and doesn't block the referrer's
          // own reward from still firing later once a qualifying bill occurs.
          let referralDiscount = 0;
          if (data.client_id && !isPackagePayment && existingPaid === 0) {
            try {
              const referredClient = await clientsRepository.findById(data.client_id, data.salon_id);
              if (referredClient?.referred_by_client_id && !referredClient.referral_referee_rewarded) {
                const refConfig = await referralRepository.getConfig(data.salon_id);
                if (refConfig.active && refConfig.referee_reward_amount > 0) {
                  if (actualBill >= refConfig.min_bill_amount) {
                    referralDiscount = Math.min(refConfig.referee_reward_amount, actualBill);
                    // Persisted onto the sale below (referral_id/referral_source)
                    // so Sale Details/Client History can show who referred this
                    // client, not just that "some" referral discount applied.
                    data.referral_id = referredClient.referred_by_client_id;
                    data.referral_source = 'referral_program';
                  } else {
                    refereeWalletCredit = refConfig.referee_reward_amount;
                    // Own dedicated referral balance now — no longer eWallet money.
                    await referralRepository.applyLedgerEntry({
                      clientId: data.client_id,
                      salonId: data.salon_id,
                      type: 'earn',
                      delta: refereeWalletCredit,
                      sourceType: 'referral_welcome',
                      sourceId: data.client_id,
                      note: `Referral welcome reward — bill below ₹${refConfig.min_bill_amount} minimum for an instant discount, credited to referral balance instead`,
                    });
                  }
                  await clientsRepository.markRefereeRewarded(data.client_id);
                }
              }
            } catch (err: any) {
              logger.warn('[payments] referral discount check failed:', err?.message ?? err);
            }
          }
          data.referral_discount_applied = referralDiscount;
          // Persist the combined figure — the sale-creation block below reads
          // data.discount_amount to net revenue, and it must include this
          // referral piece too, same as it already does for coupon/manual.
          // computeBillTotals below is given the three components separately
          // (frontendManualDiscount/frontendCouponDiscount/referralDiscount) —
          // this combined figure is ONLY for sale-record revenue netting.
          data.discount_amount = combinedFrontendDiscount + referralDiscount;

          // Both are real amounts the client actually pays alongside the bill —
          // an ex-charge (business keeps it) and a tip (passed to staff) — so
          // both must be part of what's owed/collected here, even though only
          // ex_charges counts as revenue once it reaches the sale record.
          // Computed here (earlier than before) because the sequential
          // deduction ceiling just below needs them.
          exChargesAmt = Number(appt.ex_charges) || 0;
          tipAmt       = Number(appt.tip_amount) || 0;
          tipAddedToSalon = !!(appt as any).tip_added_to_salon;
          tipBreakdown = (appt as any).tip_breakdown ?? null;

          // ── Sequential benefit deduction ────────────────────────────────────
          // eWallet / membership wallet / reward points / referral credit used
          // to each be computed independently, capped only against their OWN
          // balance — never against how much of the bill was actually still
          // left after the others. That let their combined value vastly
          // exceed the bill (e.g. membership alone fully covers it, then
          // eWallet and reward points still get deducted in full on top of
          // that) — not just a display bug, since each of these is a REAL
          // ledger deduction. `remaining` is threaded through all four, in
          // the same order the Sale Summary displays them, and each is capped
          // at whatever's actually still owed at that point.
          //
          // The starting ceiling needs a real, tax-inclusive grand total, but
          // the tax-exclusion adjustment for membership-wallet-covered items
          // depends on knowing the wallet amount, which isn't known yet — a
          // genuine circular dependency. Resolved by using a preliminary,
          // not-yet-wallet-adjusted grand total as the ceiling (that
          // exclusion only ever shifts the GST portion, not the whole bill,
          // so this is a safe, slightly conservative estimate) and
          // recomputing the exact final figure with computeBillTotals() once
          // every actual deduction is known.
          // ── Membership discount (percentage / loyalty) ──────────────────────
          // Resolved BEFORE the ceiling, unlike the four redemptions below,
          // because this is a genuine pre-tax price reduction: it lowers the
          // taxable base and therefore the grand total everything else is
          // capped against. Deducting the pool is idempotent per appointment
          // (same contract as the wallet), so repeat/partial payment calls
          // re-read the already-given amount instead of granting it twice.
          let membershipDiscountUsed = 0;
          // Keyed by service_id/product_id — lets the tax engine exclude each
          // row's OWN discount from its taxable base below, mirroring
          // walletUsedByItem. Empty in the fallback branch for a loyalty
          // discount specifically (no ledger row exists to read it back from,
          // since loyalty has no balance to protect) — the aggregate total
          // still stays correct via getMembershipDiscountForAppointment, only
          // the per-ROW GST split degrades to 0 in that narrow, repeat-call
          // edge case.
          let membershipDiscountByItem = new Map<string, number>();
          if (data.client_id && (data.apply_membership_discount || data.apply_loyalty_discount)) {
            try {
              const result = await applyMembershipDiscountForBooking(
                data.salon_id, data.client_id, data.appointment_id,
                (appt.services || []).map(s => ({
                  itemId: s.service_id, name: s.name,
                  amount: lineTotal(s), isPackageService: !!(s as any).is_package_service,
                  categoryId: s.category_id ?? undefined,
                })),
                (appt.product_items || []).filter(p => !!p.product_id).map(p => ({
                  itemId: p.product_id as string, name: p.name,
                  amount: lineTotal(p), isPackageService: false,
                  categoryId: p.category_id ?? undefined,
                })),
                !!data.apply_membership_discount,
                !!data.apply_loyalty_discount,
              );
              membershipDiscountUsed = result.total;
              membershipDiscountByItem = result.perItem;
            } catch (err: any) {
              logger.warn('[payments] membership discount failed:', err?.message ?? err);
            }
          } else if (data.client_id) {
            // Box unchecked, but a prior call on this appointment may already
            // have granted it — it cannot be un-granted, so the bill has to
            // keep reflecting it.
            // Prior payments, not the usage ledger — this has to cover loyalty
            // too, which grants a discount without ever writing a ledger row.
            membershipDiscountUsed = await paymentsRepository
              .getMembershipDiscountForAppointment(data.appointment_id).catch(() => 0);
            // Recover the per-item split too, if a percentage membership's
            // ledger has it (loyalty never writes one — see comment above).
            membershipDiscountByItem = await clientMembershipsRepository
              .getDiscountGivenPerItemForAppointment(data.appointment_id).catch(() => new Map<string, number>());
          }
          data.membership_discount_used = membershipDiscountUsed;

          // Bucket split of the discount, computed once and reused by BOTH
          // computeBillTotals calls below — gstAmount is computed from this
          // per-bucket carve-out, not from membershipDiscountAmount directly,
          // so omitting it here (even though only `taxable`/`grandTotal` from
          // this preliminary call actually get used as the redemption ceiling)
          // would silently overstate the ceiling's own tax component.
          const membershipServiceDiscountUsed = (appt.services || []).reduce(
            (s, i) => s + (membershipDiscountByItem.get(String(i.service_id)) ?? 0), 0,
          );
          const membershipProductDiscountUsed = (appt.product_items || []).reduce(
            (s, i) => s + (membershipDiscountByItem.get(String(i.product_id)) ?? 0), 0,
          );

          const activeTaxesForCeiling = data.include_gst === false ? [] : await getActiveTaxes(data.salon_id).catch(() => []);
          const preliminaryTotals = computeBillTotals({
            actualAmounts: { service: serviceTotal, packages: packageTotal, product: productTotal, membership: membershipTotal },
            // Deliberately 'flat' with NO discountAppliesTo: what arrives here
            // is an already-resolved ₹ amount that the preview engine computed
            // (and already scoped/capped) from the staff's %-or-flat input and
            // their Apply-to selection. Threading discountAppliesTo through
            // here too would re-apply that cap to an amount it was already
            // applied to, shrinking the discount a second time on bills whose
            // selected base is smaller than the charge. Omitting it selects
            // legacy/uncapped scope, which is exactly right for a pre-resolved
            // amount. Do not "fix" this by passing the bill's selection.
            discountType: 'flat',
            discountValue: frontendManualDiscount,
            couponDiscount: frontendCouponDiscount,
            membershipDiscountAmount: membershipDiscountUsed,
            membershipServiceDiscountUsed,
            membershipProductDiscountUsed,
            referralDiscount,
            taxes: activeTaxesForCeiling,
            exCharges: exChargesAmt,
            tip: tipAmt,
            tipAddedToSalon,
            roundSubtotalBeforeDiscount: true,
          });
          // Ceiling for the sequential Membership Wallet → eWallet → Reward
          // Points → Referral Credit capping below — rooted in the raw
          // pre-redemption total, NOT grandTotal (which now already has those
          // redemptions subtracted and would double-count as a ceiling).
          let remaining = preliminaryTotals.preRedemptionTotal;

          // ── Membership wallet: redeem against services, plus products when the
          // client's membership opted in ──────────────────────────────────────
          // Applied first (matches the Sale Summary's own display order —
          // Membership, then eWallet, then Reward Points, then Referral).
          // Manual opt-in — only deducts when the staff checked "Apply
          // Membership" (data.apply_membership_wallet). Deducts once per
          // appointment (idempotent across repeat/partial-payment calls — see
          // deductOrReuseWalletForAppointment); if a PRIOR payment call for
          // this appointment already deducted (checkbox was checked then),
          // that already-spent amount still applies even if this call has the
          // box unchecked — it can't be un-deducted, so the bill stays
          // consistent with what was actually taken from the wallet. Never
          // blocks a payment on a wallet-system error; customer just pays
          // full price in that case.
          let membershipWalletUsed = 0;
          if (data.client_id) {
            try {
              if (data.apply_membership_wallet) {
                // Per-membership applies_to setting — a plan can now be
                // services-only, products-only, or both; services are no
                // longer unconditionally eligible the way they used to be
                // before "products only" existed as an option.
                const { coversServices, coversProducts, serviceCategoryIds, productCategoryIds, serviceItemIds, productItemIds } =
                  await clientMembershipsService.getWalletCoverage(data.salon_id, data.client_id);
                // Additive: a row is covered if its category is in the
                // *CategoryIds list OR its own id is in the *ItemIds list —
                // only jointly empty means unrestricted. See
                // resolveCategoryRestriction/resolveItemRestriction in
                // client-memberships.repository.ts.
                const coversServiceRow = (s: { category_id?: string | null; service_id?: string | null }) =>
                  (!serviceCategoryIds?.length && !serviceItemIds?.length)
                  || (!!serviceCategoryIds?.length && !!s.category_id && serviceCategoryIds.includes(s.category_id))
                  || (!!serviceItemIds?.length && !!s.service_id && serviceItemIds.includes(s.service_id));
                const coversProductRow = (p: { category_id?: string | null; product_id?: string | null }) =>
                  (!productCategoryIds?.length && !productItemIds?.length)
                  || (!!productCategoryIds?.length && !!p.category_id && productCategoryIds.includes(p.category_id))
                  || (!!productItemIds?.length && !!p.product_id && productItemIds.includes(p.product_id));
                const itemsForWallet = [
                  ...(coversServices ? (appt.services || [])
                    .filter(coversServiceRow)
                    .map(s => ({
                      serviceId:   s.service_id,
                      serviceName: s.name,
                      amount:      (Number(s.price) || 0) * qty(s),
                    })) : []),
                  ...(coversProducts ? (appt.product_items || [])
                    .filter(p => !!p.product_id)
                    .filter(coversProductRow)
                    .map(p => ({
                      serviceId:   p.product_id as string,
                      serviceName: p.name,
                      amount:      (Number(p.price) || 0) * qty(p),
                    })) : []),
                ];
                if (itemsForWallet.length > 0 && remaining > 0) {
                  // Cap at whatever's still left on the bill, not just
                  // whatever the staff requested — otherwise this could
                  // still fully drain the wallet even once other benefits
                  // (later in the sequence) would have covered the rest.
                  const cappedMembershipRequest = Math.min(
                    data.membership_wallet_requested ?? Infinity,
                    remaining,
                  );
                  const result = await clientMembershipsService.deductWalletForBooking(
                    data.salon_id, data.client_id, data.appointment_id, itemsForWallet,
                    cappedMembershipRequest,
                  );
                  membershipWalletUsed = result.totalWalletUsed;
                }
              } else {
                membershipWalletUsed = await clientMembershipsRepository.getWalletUsedForAppointment(data.appointment_id);
              }
            } catch (err: any) {
              logger.warn('[payments] membership wallet deduction failed:', err?.message ?? err);
            }
          }
          remaining = Math.max(0, remaining - membershipWalletUsed);

          // ── eWallet: recompute server-side from the client's real balance ──
          // Never trust a ₹ amount sent from the frontend — cap it at what the
          // client actually has AND at what's still left on the bill after
          // membership wallet coverage above.
          let ewallet = 0;
          if (data.client_id && ewalletRequested > 0 && remaining > 0) {
            try {
              const balance = await ewalletRepository.getBalance(data.client_id);
              ewallet = Math.min(ewalletRequested, balance, remaining);
            } catch (err: any) {
              logger.warn('[payments] ewallet balance check failed:', err?.message ?? err);
            }
          }
          ewalletUsedActual = ewallet;
          data.ewallet_used = ewallet;
          remaining = Math.max(0, remaining - ewallet);

          // Per-item wallet-used breakdown — read back from membership_usage_log
          // (persisted above, whether deducted just now or on a prior call for
          // this appointment) rather than relying on deductWalletForBooking's
          // in-memory result, so this works identically for both branches above.
          // Used below to exclude the wallet-covered portion of each service/
          // product from GST — a client shouldn't be taxed on money that never
          // actually changed hands as a sale.
          let serviceWalletUsed = 0;
          let productWalletUsed = 0;
          // Hoisted out of the `if` below (rather than a local `const` inside
          // it) so the per-row tax allocation further down can also look up
          // each individual service/product's own wallet-covered amount, not
          // just the bucket-level sums.
          let walletUsedByItem = new Map<string, number>();
          if (membershipWalletUsed > 0) {
            try {
              walletUsedByItem = await clientMembershipsRepository.getWalletUsedPerItemForAppointment(data.appointment_id);
              serviceWalletUsed = (appt.services || []).reduce(
                (s, i) => s + (walletUsedByItem.get(String(i.service_id)) ?? 0), 0,
              );
              productWalletUsed = (appt.product_items || []).reduce(
                (s, i) => s + (walletUsedByItem.get(String(i.product_id)) ?? 0), 0,
              );
            } catch (err: any) {
              logger.warn('[payments] membership wallet per-item lookup failed:', err?.message ?? err);
            }
          }

          // ── Reward points redemption: own dedicated balance now, not eWallet.
          // Never trust a points count sent from the frontend — cap it at the
          // client's real balance, same principle as eWallet above. Converted
          // to ₹ via the salon's configured redeem rate at redemption time
          // (earning no longer does this conversion — see the earn block below).
          let rewardPointsRedeemedValue = 0;
          const rewardPointsRequested = Math.max(0, Number(data.reward_points_used) || 0);
          if (data.client_id && rewardPointsRequested > 0 && remaining > 0) {
            try {
              const [rpConfig, rpBalance] = await Promise.all([
                rewardPointsRepository.getConfig(data.salon_id),
                rewardPointsRepository.getBalance(data.client_id),
              ]);
              let pointsToRedeem = Math.min(rewardPointsRequested, rpBalance);
              if (pointsToRedeem > 0 && rpConfig.redeem_points > 0) {
                let value = (pointsToRedeem / rpConfig.redeem_points) * rpConfig.redeem_value;
                // Never trust a redemption % cap check the frontend already
                // did — reward points alone can never cover more than
                // max_redeem_percent of the ORIGINAL bill (preRedemptionTotal,
                // not `remaining`), regardless of how much is still left after
                // membership/eWallet. 100 (the default) is a no-op.
                const percentCap = preliminaryTotals.preRedemptionTotal * (rpConfig.max_redeem_percent / 100);
                const cap = Math.min(remaining, percentCap);
                if (value > cap) {
                  // Cap the ₹ value at the lower of what's left / the percent
                  // cap, then work backward to how many points that actually
                  // costs — floor so this can only ever slightly UNDER-redeem,
                  // never exceed either limit.
                  pointsToRedeem = Math.floor((cap / rpConfig.redeem_value) * rpConfig.redeem_points);
                  value = (pointsToRedeem / rpConfig.redeem_points) * rpConfig.redeem_value;
                }
                rewardPointsRedeemedActual = pointsToRedeem;
                rewardPointsRedeemedValue = value;
              }
            } catch (err: any) {
              logger.warn('[payments] reward points balance check failed:', err?.message ?? err);
            }
          }
          data.reward_points_used = rewardPointsRedeemedActual;
          data.reward_points_value = rewardPointsRedeemedValue;
          remaining = Math.max(0, remaining - rewardPointsRedeemedValue);

          // ── Referral credit redemption: own dedicated balance now, not
          // eWallet. Never trust a ₹ amount sent from the frontend — cap it
          // at the client's real balance AND at what's still left on the bill.
          let referralCreditRequestedValue = 0;
          const referralCreditRequested = Math.max(0, Number(data.referral_credit_used) || 0);
          if (data.client_id && referralCreditRequested > 0 && remaining > 0) {
            try {
              const referralBalance = await referralRepository.getBalance(data.client_id);
              referralCreditUsedActual = Math.min(referralCreditRequested, referralBalance, remaining);
              referralCreditRequestedValue = referralCreditUsedActual;
            } catch (err: any) {
              logger.warn('[payments] referral balance check failed:', err?.message ?? err);
            }
          }
          data.referral_credit_used = referralCreditUsedActual;
          remaining = Math.max(0, remaining - referralCreditRequestedValue);

          // ── Tax + grand total: single shared pricing engine (see
          // pricing.engine.ts) — the same math totalsUtils.ts uses on the
          // frontend, extended so this backend call site is the authoritative
          // source of what's actually owed, not just item prices minus discount.
          // Previously tax was skipped entirely here, so the receipt correctly
          // displayed tax but the appointment could be marked "Paid" for less
          // than what was shown to the client.
          // Fallback if computeBillTotals below throws. membershipDiscountUsed
          // and frontendCouponDiscount are pre-tax reductions; Extra Charges
          // are added after (Tip is NOT — Staff Tip is display/record-only,
          // never collected as part of the bill, see pricing.engine.ts);
          // Referral Discount and the redemptions are all subtracted after
          // that — grandTotal here already IS the fully-reduced figure
          // (merged with what used to be a separate effectiveBill concept),
          // matching computeBillTotals's new formula.
          let grandTotal = Math.round(Math.max(0,
            actualBill - frontendManualDiscount - frontendCouponDiscount - membershipDiscountUsed
          ) + exChargesAmt - referralDiscount - ewallet - membershipWalletUsed
            - rewardPointsRedeemedValue - referralCreditRequestedValue);
          let effectiveBill = grandTotal;
          try {
            const activeTaxes = data.include_gst === false ? [] : await getActiveTaxes(data.salon_id);
            // Same lineTotal fallback used by itemDiscount() further down
            // (unitPrice*qty unless a real `total` is already stored on the
            // item) — kept in sync deliberately, both derive the row's own
            // post-item-discount base from the exact same raw appt arrays.
            const rowTotal = (i: any) => {
              const unitPrice = Number(i.price) || 0;
              const q = Number(i.quantity) || Number(i.qty) || 1;
              const t = Number(i.total);
              return (i.total !== undefined && i.total !== null && isFinite(t)) ? t : unitPrice * q;
            };
            const result = computeBillTotals({
              actualAmounts: { service: serviceTotal, packages: packageTotal, product: productTotal, membership: membershipTotal },
              discountType: 'flat',
              discountValue: frontendManualDiscount,
              couponDiscount: frontendCouponDiscount,
              membershipDiscountAmount: membershipDiscountUsed,
              membershipServiceDiscountUsed,
              membershipProductDiscountUsed,
              referralDiscount,
              taxes: activeTaxes,
              exCharges: exChargesAmt,
              tip: tipAmt,
              tipAddedToSalon,
              eWalletUsed: ewallet,
              membershipWalletUsed,
              rows: {
                service: (appt.services || []).map(s => ({
                  price: Number(s.price) || 0, qty: Number(s.quantity) || 1, total: rowTotal(s),
                  isPackageService: !!s.is_package_service,
                  walletUsed: walletUsedByItem.get(String(s.service_id)) ?? 0,
                  membershipDiscountUsed: membershipDiscountByItem.get(String(s.service_id)) ?? 0,
                })),
                packages: (appt.package_items || []).map(p => ({
                  price: Number(p.price) || 0, qty: Number(p.quantity) || 1, total: rowTotal(p),
                })),
                product: (appt.product_items || []).map(p => ({
                  price: Number(p.price) || 0, qty: Number(p.quantity) || 1, total: rowTotal(p),
                  walletUsed: walletUsedByItem.get(String(p.product_id)) ?? 0,
                  membershipDiscountUsed: membershipDiscountByItem.get(String(p.product_id)) ?? 0,
                })),
                membership: (appt.membership_items || []).map(m => ({
                  price: Number(m.price) || 0, qty: Number(m.quantity) || 1, total: rowTotal(m),
                })),
              },
              // Membership-wallet-covered amounts are excluded from the taxable
              // base (not just the discount ratio) — that portion of the item
              // was never actually charged to the client, so it shouldn't be
              // taxed either. Only service/product buckets can carry wallet
              // coverage today (see itemsForWallet above); packages/memberships
              // are untouched. Deliberately NOT subtracted from actualBill/
              // grandTotal elsewhere — effectiveBill already subtracts the full
              // membershipWalletUsed once; doing it here too would double-count.
              membershipServiceWalletUsed: serviceWalletUsed,
              membershipProductWalletUsed: productWalletUsed,
              rewardPointsRedeemedValue,
              referralCreditUsed: referralCreditRequestedValue,
              // Reproduces this call site's pre-existing rounding order — see
              // the doc comment on this flag in pricing.engine.ts.
              roundSubtotalBeforeDiscount: true,
            });
            taxAmount = result.gstAmount;
            grandTotal = result.grandTotal;
            effectiveBill = result.grandTotal;
            taxableAmount = result.taxable;
            rowTaxByBucket = result.rowTax;
            rowTaxableByBucket = result.rowTaxableAmount;
            // Overwrite whatever the frontend sent with this call's own
            // authoritative recomputation — same reasoning as gross_amount/
            // net_amount/paid_amount/due_amount below, which already don't
            // trust the frontend. Without this, payments.repository.ts's
            // INSERT persisted data.tax_breakdown verbatim from the request
            // body, so the receipt/View Appointment always showed whatever
            // GST the frontend's own (possibly stale, or simply differently-
            // computed) preview had — e.g. computed on the pre-membership-
            // -discount subtotal — even though this call had just computed
            // the correct, discount-aware figure right here.
            data.tax_breakdown = result.taxBreakdown;
          } catch (err: any) {
            logger.warn('[payments] tax computation failed:', err?.message ?? err);
          }

          data.membership_wallet_used = membershipWalletUsed;

          // `|| ` treats 0 as "not provided" and falls through to gross_amount — which
          // silently records the full pre-discount catalog price as "paid" whenever a
          // coupon/wallet/points deduction legitimately brings paid_amount to ₹0 (e.g. a
          // 100%-off coupon), overcharging the customer's recorded payment by the full bill.
          // Capped at what's actually still owed — there's no "change given back" concept
          // in this system, so a frontend-sent amount above the remaining due (e.g. a POS
          // cash/split entry typo) must never be persisted as-is, or reports/KPIs downstream
          // silently show paid > billed for that transaction.
          //
          // Capped at effectiveBill only — tip is deliberately NOT part of this ceiling.
          // The client may hand over bill+tip in one swipe (see receipt-html.template.ts's
          // printed Grand Total), but paid_amount/due_amount only ever settle the bill
          // portion; tip is tracked and settled entirely separately via tip_amount +
          // tipCalculationService (Tip Settle), never through payments.paid_amount. This
          // keeps every dashboard/report/client-spend figure that reads paid_amount
          // tip-free by construction, instead of needing to subtract tip back out everywhere.
          const requestedPaid = Math.max(0, (
            data.paid_amount != null ? Number(data.paid_amount)
            : data.net_amount  != null ? Number(data.net_amount)
            : Number(data.gross_amount) || 0
          ));
          const thisPaid = Math.min(requestedPaid, Math.max(0, effectiveBill - existingPaid));

          data.gross_amount = actualBill;
          data.net_amount   = effectiveBill;
          data.paid_amount  = thisPaid;
          data.due_amount   = Math.max(0, parseFloat((effectiveBill - existingPaid - thisPaid).toFixed(2)));
          data.status       = data.due_amount > 0 ? 'partial' : 'completed';
        }
      } catch {
        // Non-fatal: fall through and use frontend-supplied values
      }
    } else if (data.appointment_id && isPackagePayment) {
      // Package payments: customer already paid via the package purchase.
      // Trust frontend values (paid=0, due=0, status='completed') and just
      // fetch the appointment so membership auto-create has appt context.
      try { appt = await appointmentsRepository.findById(data.appointment_id); } catch { /* non-fatal */ }
      data.gross_amount = 0;
      data.net_amount   = 0;
      data.paid_amount  = 0;
      data.due_amount   = 0;
      data.status       = 'completed';
      // Package payments skip the existingPaid lookup above (no money changes
      // hands), so derive the same "first payment" signal from appt.status
      // directly — needed so the consumable deduction below still fires for
      // ₹0 package-covered appointments, which never reach /checkout but do
      // still need their consumables deducted on this, their one settling call.
      isFirstPaymentForAppointment = !!appt && !['partial', 'paid'].includes(appt.status);
    }

    // ── Consumables: collect the rows to deduct at the status flip below ────
    // Products are physically used the moment the service is rendered, not
    // when the bill is finally settled — so deduction fires on the FIRST
    // payment ever recorded against this appointment (isFirstPaymentForAppointment,
    // computed above from existingPaid === 0), whether that first payment is
    // itself partial or full. Previously this was gated on data.status ===
    // 'completed', so a partially-paid appointment never deducted stock even
    // though the consumables had already been used, causing an inventory
    // mismatch. A second, later call that only tops up an already-partial
    // payment (or finally clears it to 'paid') must NOT deduct again —
    // existingPaid > 0 by then, so this only ever fires once.
    // Consumables never affect any of the money math above (they were never
    // part of it) — this is purely an inventory side-effect of completion.
    // Deliberately NOT stock-validated: an out-of-stock consumable must never
    // block taking the customer's money. The deduction below runs with
    // allowNegative, recording the usage and flooring products.amount at 0.
    let pendingConsumableRows: AppointmentServiceConsumableRecord[] = [];
    if (isFirstPaymentForAppointment && !!appt && !!data.appointment_id) {
      pendingConsumableRows = await appointmentsRepository.getServiceConsumables(data.appointment_id!);
    }

    // Reports that read payments.payment_method directly (e.g. Sales Summary's
    // COALESCE(pay.latest_method, ...) — see reports.repository.ts) must see
    // the same corrected source, not the frontend's raw (often wrong, see
    // buildMethodLabel()'s "Cash" fallback) label. payments.payment_method has
    // no CHECK constraint, so it can carry the full readable "Package + Cash"
    // form directly rather than the constrained sales.payment_method enum.
    if (!isPackagePayment) {
      data.payment_method = describePaymentMethod(data.payment_method || '', data.split_details, {
        package: data.package_covered_amount,
        membership: (Number(data.membership_wallet_used) || 0) + (Number(data.membership_discount_used) || 0),
      });
    }

    // Payment creation and the reward-points redemption ledger write must
    // not diverge: without a shared transaction, a ledger write failure
    // after the payment row was already persisted with reward_points_used/
    // reward_points_value set would leave the payment claiming points were
    // redeemed that were never actually deducted from the client's balance.
    // Run both on one transaction so a ledger failure rolls back the
    // payment instead of being silently swallowed.
    let payment: Payment;
    let rewardPointsRemainingAfterRedeem: number | null = null;
    if (data.client_id && rewardPointsRedeemedActual > 0) {
      const txClient = await pool.connect();
      try {
        await txClient.query('BEGIN');
        payment = await paymentsRepository.create(data, txClient);
        rewardPointsRemainingAfterRedeem = await rewardPointsRepository.applyLedgerEntry({
          clientId: data.client_id,
          salonId: data.salon_id,
          type: 'redeem',
          delta: -rewardPointsRedeemedActual,
          sourceType: 'payment',
          sourceId: payment.id,
          note: `Redeemed ${rewardPointsRedeemedActual} points on payment`,
        }, txClient);
        await txClient.query('COMMIT');
      } catch (err) {
        await txClient.query('ROLLBACK');
        throw err;
      } finally {
        txClient.release();
      }

      // ── WhatsApp Automation: Reward Points Used ─────────────────────────
      // Fired outside the transaction — network I/O has no business holding
      // a DB transaction open, and the redemption itself is already durably
      // committed by this point regardless of whether the notification send
      // succeeds.
      const spender = await clientsRepository.findById(data.client_id, data.salon_id);
      if (spender?.phone_number) {
        const salon = await salonsRepository.findById(data.salon_id);
        whatsappAutomationService.trigger({
          salonId:       data.salon_id,
          eventType:     'reward_points_used',
          clientId:      data.client_id,
          phone:         spender.phone_number,
          countryCode:   spender.phone_country_code ?? null,
          variables: {
            '1': spender.full_name ?? 'Valued Customer',
            '2': String(rewardPointsRedeemedActual),
            '3': salon?.business_name ?? 'our salon',
            '4': String(rewardPointsRemainingAfterRedeem ?? 0),
          },
          referenceId:   payment.id,
          referenceType: 'payment',
          dedupeByReference: true,
        }).catch(() => {});
      }
    } else {
      payment = await paymentsRepository.create(data);
    }

    // ── eWallet: actually deduct the real balance now that the payment row exists ──
    if (data.client_id && ewalletUsedActual > 0) {
      try {
        const remainingBalance = await ewalletRepository.applyLedgerEntry({
          clientId: data.client_id,
          salonId: data.salon_id,
          type: 'redeem',
          delta: -ewalletUsedActual,
          sourceType: 'payment',
          sourceId: payment.id,
          note: `Used for ₹${ewalletUsedActual.toFixed(2)} payment`,
        });

        // ── WhatsApp Automation: eWallet Used ──────────────────────────────
        const spender = await clientsRepository.findById(data.client_id, data.salon_id);
        if (spender?.phone_number) {
          const salon = await salonsRepository.findById(data.salon_id);
          whatsappAutomationService.trigger({
            salonId:       data.salon_id,
            eventType:     'ewallet_used',
            clientId:      data.client_id,
            phone:         spender.phone_number,
            countryCode:   spender.phone_country_code ?? null,
            variables: {
              '1': spender.full_name ?? 'Valued Customer',
              '2': ewalletUsedActual.toFixed(2),
              '3': salon?.business_name ?? 'our salon',
              '4': remainingBalance.toFixed(2),
            },
            referenceId:   payment.id,
            referenceType: 'payment',
            dedupeByReference: true,
          }).catch(() => {});
        }
      } catch (err: any) {
        logger.warn('[payments] ewallet redeem ledger write failed:', err?.message ?? err);
      }
    }

    // Reward points redemption ledger write now happens atomically with
    // payment creation above (see the transaction block).

    // ── Referral credit: actually deduct the real balance now that the
    // payment row exists — mirrors the eWallet redeem block above exactly.
    if (data.client_id && referralCreditUsedActual > 0) {
      try {
        const remainingBalance = await referralRepository.applyLedgerEntry({
          clientId: data.client_id,
          salonId: data.salon_id,
          type: 'redeem',
          delta: -referralCreditUsedActual,
          sourceType: 'payment',
          sourceId: payment.id,
          note: `Used ₹${referralCreditUsedActual.toFixed(2)} referral credit for payment`,
        });

        // ── WhatsApp Automation: Referral Credit Used ──────────────────────
        const spender = await clientsRepository.findById(data.client_id, data.salon_id);
        if (spender?.phone_number) {
          const salon = await salonsRepository.findById(data.salon_id);
          whatsappAutomationService.trigger({
            salonId:       data.salon_id,
            eventType:     'referral_credit_used',
            clientId:      data.client_id,
            phone:         spender.phone_number,
            countryCode:   spender.phone_country_code ?? null,
            variables: {
              '1': spender.full_name ?? 'Valued Customer',
              '2': referralCreditUsedActual.toFixed(2),
              '3': salon?.business_name ?? 'our salon',
              '4': remainingBalance.toFixed(2),
            },
            referenceId:   payment.id,
            referenceType: 'payment',
            dedupeByReference: true,
          }).catch(() => {});
        }
      } catch (err: any) {
        logger.warn('[payments] referral credit redeem ledger write failed:', err?.message ?? err);
      }
    }

    // ── Visit counter: powers loyalty-membership thresholds ────────────────
    // Counted on the first payment for an appointment rather than on
    // completion, so a bill left partially paid still registers the visit —
    // the client did turn up. Non-fatal: a failure here must never block a
    // payment, it only delays a loyalty unlock.
    if (data.client_id && !isPackagePayment && isFirstPaymentForAppointment) {
      try {
        await clientsRepository.recordVisit(data.client_id, data.salon_id);
      } catch (err: any) {
        logger.warn('[payments] visit counter update failed:', err?.message ?? err);
      }
    }

    // ── Reward earnings: credited to their own dedicated points balance —
    // no longer converted to ₹ and folded into eWallet. Reviving the
    // pre-existing (previously dormant) reward_points_balance/ledger
    // mechanism. Conversion to ₹ now only happens at redemption time
    // (see the redemption block above / near ewalletUsedActual).
    // Earn only on a fully-paid bill — a Partial payment doesn't earn yet,
    // since the sale isn't settled (matches how eWallet/wallet are only ever
    // debited, never speculatively credited before the bill is closed).
    if (data.client_id && data.status === 'completed' && !isPackagePayment) {
      try {
        const config = await rewardPointsRepository.getConfig(data.salon_id);
        if (config.active && config.spend_amount > 0) {
          const pointsEarned = Math.floor((Number(data.net_amount) / config.spend_amount) * config.points_earned);
          if (pointsEarned > 0) {
            const newBalance = await rewardPointsRepository.applyLedgerEntry({
              clientId: data.client_id,
              salonId: data.salon_id,
              type: 'earn',
              delta: pointsEarned,
              sourceType: 'payment',
              sourceId: payment.id,
              note: `Earned on ₹${Number(data.net_amount).toFixed(2)} payment`,
            });

            // ── WhatsApp Automation: Reward Points Earned ────────────────────
            const earner = await clientsRepository.findById(data.client_id, data.salon_id);
            if (earner?.phone_number) {
              const salon = await salonsRepository.findById(data.salon_id);
              whatsappAutomationService.trigger({
                salonId:       data.salon_id,
                eventType:     'reward_points_earned',
                clientId:      data.client_id,
                phone:         earner.phone_number,
                countryCode:   earner.phone_country_code ?? null,
                variables: {
                  '1': earner.full_name ?? 'Valued Customer',
                  '2': String(pointsEarned),
                  '3': salon?.business_name ?? 'our salon',
                  '4': String(newBalance),
                },
                referenceId:   payment.id,
                referenceType: 'payment',
                dedupeByReference: true,
              }).catch(() => {});
            }
          }
        }
      } catch (err: any) {
        logger.warn('[payments] reward earn ledger write failed:', err?.message ?? err);
      }
    }

    // ── Refer & Earn: credit the referrer's wallet once the referred client's
    // first bill is fully paid ─────────────────────────────────────────────
    // The referee's own reward was already applied above as an instant
    // discount on this same bill — this only handles the referrer's side.
    // Re-fetched fresh rather than reusing state from the block above, because
    // the discount and the completion can happen on different calls: a partial
    // payment gets the discount on call 1 (existingPaid === 0), but the bill
    // might only reach status 'completed' on a later call once the remaining
    // due is cleared — this must still fire then.
    // Gated on referral_reward_status === 'pending' so it can only ever fire
    // once per referred client, regardless of how many payments follow.
    if (data.client_id && data.status === 'completed' && !isPackagePayment) {
      try {
        const referredClient = await clientsRepository.findById(data.client_id, data.salon_id);
        if (referredClient?.referred_by_client_id && referredClient.referral_reward_status === 'pending') {
          const config = await referralRepository.getConfig(data.salon_id);
          const billAmount = Number(data.gross_amount) || 0;
          if (config.active && billAmount >= config.min_bill_amount) {
            if (config.referrer_reward_amount > 0) {
              // Own dedicated referral balance now — no longer eWallet money.
              const newReferralBalance = await referralRepository.applyLedgerEntry({
                clientId: referredClient.referred_by_client_id,
                salonId: data.salon_id,
                type: 'earn',
                delta: config.referrer_reward_amount,
                sourceType: 'referral_payout',
                sourceId: data.client_id,
                note: 'Referral reward for referring a new customer',
              });

              // ── WhatsApp Automation: Referral Reward Credited ──────────────
              const referrer = await clientsRepository.findById(referredClient.referred_by_client_id, data.salon_id);
              if (referrer?.phone_number) {
                const salon = await salonsRepository.findById(data.salon_id);
                whatsappAutomationService.trigger({
                  salonId:       data.salon_id,
                  eventType:     'referral_reward',
                  clientId:      referredClient.referred_by_client_id,
                  phone:         referrer.phone_number,
                  countryCode:   referrer.phone_country_code ?? null,
                  variables: {
                    '1': referrer.full_name ?? 'Valued Customer',
                    '2': referredClient.full_name ?? 'your referral',
                    '3': salon?.business_name ?? 'our salon',
                    '4': String(config.referrer_reward_amount),
                    '5': String(newReferralBalance),
                  },
                  referenceId:   data.client_id,
                  referenceType: 'client',
                  dedupeByReference: true,
                }).catch(() => {});
              }
            }
            await clientsRepository.markReferralRewarded(data.client_id);
          }
        }
      } catch (err: any) {
        logger.warn('[payments] referral reward crediting failed:', err?.message ?? err);
      }
    }

    // Increment coupon used_count
    if (data.coupon_code) {
      const coupon = await couponsRepository.findByCodeForSalon(data.coupon_code, data.salon_id);
      if (coupon) await couponsRepository.incrementUsed(coupon.id);
    }

    // Mark appointment status based on computed due_amount — but never downgrade
    // a terminal state (cancelled/deleted) that may have raced ahead of this call.
    if (data.appointment_id) {
      try {
        if (!appt || !['cancelled', 'deleted'].includes(appt.status)) {
          const apptStatus = (data.due_amount ?? 0) > 0 ? 'partial' : 'paid';

          if (isFirstPaymentForAppointment && pendingConsumableRows.length && requesterUserId) {
            // The actual first-payment trigger the pre-check above validated
            // against — deduct now, in the same small transaction as the
            // status flip (to 'partial' or 'paid', whichever this call
            // produces), so neither can commit without the other.
            const branchId = await appointmentConsumablesService.resolveBranchId(data.salon_id, appt?.branch_id ?? null);
            if (branchId) {
              const txClient = await pool.connect();
              try {
                await txClient.query('BEGIN');
                await appointmentsRepository.updateStatus(data.appointment_id, apptStatus, txClient);
                await appointmentConsumablesService.completeAppointment({
                  rows: pendingConsumableRows, salonId: data.salon_id, branchId,
                  bookingId: data.appointment_id, userId: requesterUserId,
                }, txClient);
                await txClient.query('COMMIT');
              } catch (err: any) {
                await txClient.query('ROLLBACK');
                // The pre-check above already validated stock moments ago —
                // this only fires on a genuine race (stock moved in between).
                // Logged loudly rather than silently swallowed: a payment
                // already exists at this point, so the appointment must
                // still reach its new status even though the deduction didn't land.
                logger.error('[payments] consumable deduction failed after pre-check passed — status flip applied without it', {
                  appointmentId: data.appointment_id, message: err?.message,
                });
                await appointmentsRepository.updateStatus(data.appointment_id, apptStatus);
              } finally {
                txClient.release();
              }
            } else {
              await appointmentsRepository.updateStatus(data.appointment_id, apptStatus);
            }
          } else {
            await appointmentsRepository.updateStatus(data.appointment_id, apptStatus);
          }
        }
      } catch {
        // Non-fatal: payment is still recorded
      }
    }

    // Captured inside the recordTransaction block below (when it runs) so the
    // package/membership auto-create calls further down — outside that
    // block's own try/scope — can still link back to this bill's real sale
    // row for Invoice No / Staff lookups.
    let checkoutSaleId: string | undefined;

    // ── Auto-create sale record on any real calendar payment (partial or full) ──
    // Previously gated on data.status === 'completed' only, so a deposit/
    // partial payment (due_amount > 0, data.status = 'partial' — see the
    // status assignment above) never reached this block at all: no sale row,
    // no invoice_number, silently. Every 'partial' appointment across dev/QA/
    // prod with a genuine partial payment had sale_id = NULL as a result.
    // Now matches Quick Sale/POS checkout, which already generates an invoice
    // regardless of amount paid. recordTransaction() is idempotent per
    // appointment_id (updates the existing sale rather than duplicating), so
    // the later payment that actually settles the balance reuses the same
    // invoice number instead of minting a second one.
    // Skip for package payments — revenue was already counted when the package was purchased.
    if (data.appointment_id && (data.status === 'completed' || data.status === 'partial') && appt && !isPackagePayment) {
      try {
        // Per-row "Disc %" (see ServiceRow.tsx calcTotal()) is baked into each
        // item's own `total`, but was never carried over into the sale-item's
        // `discount_amount` below — sales.repository.ts's create() only
        // subtracts item.discount_amount from quantity×unit_price when
        // building sales.subtotal, so every item silently looked
        // full-price, inflating sales.subtotal (and therefore
        // sales.total_amount / all dashboard revenue figures) by the sum of
        // every item-level discount on the bill.
        const itemQty = (i: any) => Number(i.quantity) || Number(i.qty) || 1;
        const itemDiscount = (i: any) => {
          const unitPrice = Number(i.price) || 0;
          const q = itemQty(i);
          const t = Number(i.total);
          const lineTotal = (i.total !== undefined && i.total !== null && isFinite(t)) ? t : unitPrice * q;
          return Math.max(0, unitPrice * q - lineTotal);
        };

        const items: Array<{ item_type: 'service' | 'package' | 'product' | 'membership'; item_id?: string; staff_id?: string; name: string; quantity: number; unit_price: number; discount_amount: number; tax_amount?: number; taxable_amount?: number }> = [
          ...(appt.services || []).map((s, i) => ({
            item_type: 'service' as const,
            item_id: s.service_id,
            staff_id: s.staff_id || undefined,
            name: s.name || 'Service',
            quantity: Number(s.quantity) || 1,
            unit_price: Number(s.price) || 0,
            discount_amount: itemDiscount(s),
            tax_amount: rowTaxByBucket?.service[i],
            taxable_amount: rowTaxableByBucket?.service[i],
          })),
          ...(appt.package_items || []).map((p, i) => ({
            item_type: 'package' as const,
            item_id: p.package_id,
            staff_id: p.staff_id || undefined,
            name: p.name || 'Package',
            quantity: Number(p.quantity) || 1,
            unit_price: Number(p.price) || 0,
            discount_amount: itemDiscount(p),
            tax_amount: rowTaxByBucket?.packages[i],
            taxable_amount: rowTaxableByBucket?.packages[i],
          })),
          ...(appt.product_items || []).map((p, i) => ({
            item_type: 'product' as const,
            item_id: p.product_id || undefined,
            staff_id: p.staff_id || undefined,
            name: p.name || 'Product',
            quantity: Number(p.quantity) || 1,
            unit_price: Number(p.price) || 0,
            discount_amount: itemDiscount(p),
            tax_amount: rowTaxByBucket?.product[i],
            taxable_amount: rowTaxableByBucket?.product[i],
          })),
          ...(appt.membership_items || []).map((m, i) => ({
            item_type: 'membership' as const,
            item_id: m.membership_id || undefined,
            staff_id: m.staff_id || undefined,
            name: m.name || 'Membership',
            quantity: Number(m.quantity) || 1,
            unit_price: Number(m.price) || 0,
            discount_amount: itemDiscount(m),
            tax_amount: rowTaxByBucket?.membership[i],
            taxable_amount: rowTaxableByBucket?.membership[i],
          })),
        ];

        if (items.length === 0) {
          items.push({
            item_type: 'service' as const,
            name: appt.title || 'Appointment Service',
            quantity: 1,
            unit_price: Number(data.net_amount || data.gross_amount || 0),
            discount_amount: 0,
            tax_amount: taxAmount,
            taxable_amount: taxableAmount,
          });
        }

        const { sale, items: saleItemsForEvents, wasIdempotentReuse } = await recordTransaction({
          salon_id: data.salon_id,
          client_id: data.client_id,
          appointment_id: data.appointment_id,
          staff_id: appt.staff_id || undefined,
          origin: 'calendar_checkout',
          // The sale must be dated to when the appointment actually happened,
          // not left to default to "now" (the checkout/payment moment) —
          // otherwise a booking paid days after the visit (e.g. a settled
          // partial/deposit) shows up as having occurred on the payment date
          // everywhere sales.created_at is read as "visit date" (Reports'
          // Lost Customers/Customer Frequency/Client Revenue last_visit,
          // revenue-by-day charts, etc).
          created_at: appt.scheduled_at,
          // Membership wallet usage must reduce recognized revenue here — that
          // money was already counted as revenue when the membership itself was
          // purchased. Without this, every visit that draws down the wallet
          // counts the same money as revenue a second time. (eWallet, by
          // contrast, is correctly NOT subtracted — top-ups and referral
          // credits are never counted as revenue when added, only when spent.)
          //
          // A membership discount is subtracted for a different reason: `items`
          // below carry their full pre-discount prices, and sales.repository.ts
          // computes revenue as subtotal - discount_amount, so omitting it would
          // book revenue the client was never charged.
          discount_amount: (Number(data.discount_amount) || 0)
            + (Number(data.membership_wallet_used) || 0)
            + (Number(data.membership_discount_used) || 0),
          tax_amount: taxAmount,
          ex_charges: exChargesAmt,
          tip_amount: tipAmt,
          tip_added_to_salon: tipAddedToSalon,
          tip_breakdown: tipBreakdown,
          payment_label: data.payment_method || '',
          split_details: data.split_details ?? undefined,
          source_amounts: {
            package: data.package_covered_amount || 0,
            membership: (Number(data.membership_wallet_used) || 0) + (Number(data.membership_discount_used) || 0),
          },
          coupon_code: data.coupon_code || undefined,
          discount_type: appt.discount_type || undefined,
          discount_percent: appt.discount_type === 'percentage' ? Number(appt.discount_value ?? 0) : undefined,
          manual_discount_amount: data.manual_discount_amount,
          coupon_id: data.coupon_id,
          coupon_discount_amount: data.coupon_discount_amount,
          coupon_discount_type: data.coupon_discount_type,
          referral_discount_amount: data.referral_discount_applied,
          referral_id: data.referral_id,
          referral_source: data.referral_source,
          items,
        });
        checkoutSaleId = sale.id;

        // Note: appointment.status is managed by the checkout flow
        // (POST /api/v1/appointments/:id/checkout) to avoid double-completion
        // appointment.payment_status is updated above — that's all payments handles here

        // ── WhatsApp: PDF purchase receipt ──────────────────────────────────
        // Skip entirely on idempotent reuse — an existing sale means this
        // already fired the first time this appointment was paid.
        if (!wasIdempotentReuse) {
          const enrichedSale = sale;
          if (enrichedSale && data.client_id && (enrichedSale as any).client_phone) {
            // PDF receipt as a WhatsApp document attachment — best-effort, only
            // deliverable within 24h of the customer's last message. Failure here
            // is expected outside that window and never blocks the triggers above.
            //
            // Guarded against appointments.service.ts checkout()'s own
            // "safety net" send for the same sale (its preExistingSale branch
            // fires right after this same payment flow, for the standard
            // pay-then-checkout two-step) — whichever of the two actually
            // runs first wins the guard and sends; the other silently skips
            // instead of both firing and the client getting two PDFs.
            (async () => {
              const won = await whatsappAutomationRepository.guardInsertIfNotExists(`receipt-pdf-auto:${enrichedSale.id}`);
              console.log(`[BILL_RECEIPT] payments.service.ts guard won=${won} saleId=${enrichedSale.id}`);
              if (!won) return;

              const clientRecord = data.client_id ? await clientsRepository.findById(data.client_id, data.salon_id) : null;

              // bill_receipt-aware — sends the real Meta document-header
              // template (PDF + itemized caption, no 24h-window limit) when
              // the salon has one APPROVED, falling back to the old plain
              // PDF-only send otherwise. Previously called sendReceiptDocument
              // directly here, which never checked for bill_receipt at all —
              // since this call almost always wins the guard race against
              // appointments.service.ts checkout()'s own (correct) call, every
              // receipt was silently going out as a bare PDF with no caption.
              await sendPurchaseReceipt({
                salonId: data.salon_id,
                phone: (enrichedSale as any).client_phone,
                countryCode: (enrichedSale as any).client_phone_code ?? null,
                clientId: data.client_id ?? null,
                clientName: clientRecord?.full_name ?? (enrichedSale as any).client_name ?? "Valued Customer",
                sale: enrichedSale,
                items: saleItemsForEvents,
                appointment: appt
                  ? {
                        id: appt.id,
                        scheduledAt: appt.scheduled_at,
                        durationMinutes: appt.duration_minutes,
                        status: appt.status,
                        notes: appt.notes,
                    }
                  : null,
                paidAmount: Number(data.paid_amount) || 0,
                dueAmount: Number(data.due_amount) || 0,
                couponCode: data.coupon_code ?? null,
              });
            })().catch(() => {});
          }
        }
      } catch (err) {
        logger.error('[paymentsService] Failed to auto-create sale record:', { error: err });
        // Non-fatal: payment is already recorded
      }
    }

    // ── Zero-revenue sale record for package-covered visits ──────────────────
    // A service/product paid entirely from an already-purchased package's
    // included sessions collects no new money — the package's price was
    // already booked as revenue when the package itself was bought, so this
    // visit must NOT add revenue again. But without ANY sales row, the visit
    // has no invoice number and no recorded staff anywhere (Sales Summary,
    // Package Sale report, staff commission, etc. all show nothing for it).
    // Record the sale with every item's own price fully offset by an equal
    // discount, so subtotal/total_amount net to exactly 0 — same "wallet"
    // payment_method already used for e-wallet-covered visits (no schema
    // change), just for package sessions instead.
    if (data.appointment_id && data.status === 'completed' && appt && isPackagePayment) {
      try {
        const items: Array<{ item_type: 'service' | 'package' | 'product' | 'membership'; item_id?: string; staff_id?: string; name: string; quantity: number; unit_price: number; discount_amount: number }> = [
          ...(appt.services || []).map((s) => ({
            item_type: 'service' as const,
            item_id: s.service_id,
            staff_id: s.staff_id || undefined,
            name: s.name || 'Service',
            quantity: Number(s.quantity) || 1,
            unit_price: Number(s.price) || 0,
            discount_amount: Number(s.price) || 0,
          })),
          ...(appt.product_items || []).map((p) => ({
            item_type: 'product' as const,
            item_id: p.product_id || undefined,
            staff_id: p.staff_id || undefined,
            name: p.name || 'Product',
            quantity: Number(p.quantity) || 1,
            unit_price: Number(p.price) || 0,
            discount_amount: Number(p.price) || 0,
          })),
        ];

        if (items.length > 0) {
          const { sale } = await recordTransaction({
            salon_id: data.salon_id,
            client_id: data.client_id,
            appointment_id: data.appointment_id,
            staff_id: appt.staff_id || undefined,
            origin: 'calendar_checkout',
            // See the matching comment on the recordTransaction call above —
            // date this sale to the appointment's real scheduled time, not
            // whenever the package-covered checkout happened to run.
            created_at: appt.scheduled_at,
            // Every item's unit_price is exactly matched by its own
            // discount_amount above, so subtotal (and therefore
            // total_amount) is always 0 here — no revenue recorded twice.
            // This whole visit was covered by the package's included
            // sessions, so payment_method must read 'package', not the old
            // 'wallet' workaround — see payment-method.util.ts. source_amounts
            // takes priority whenever it's > 0; payment_label only matters as
            // a fallback for the never-really-happens case of a ₹0 catalog item.
            payment_label: 'ewallet',
            source_amounts: { package: items.reduce((s, i) => s + i.unit_price * i.quantity, 0) },
            items,
          });
          checkoutSaleId = sale.id;
        }
      } catch (err) {
        logger.error('[paymentsService] Failed to auto-create zero-revenue sale for package-covered visit:', { error: err });
        // Non-fatal: payment is already recorded
      }
    }

    // Payment email is handled by appointments.service checkout — skip here to avoid duplicates

    // ── Auto-create client_memberships when memberships are sold ─────────────
    // Use membership_items from DB (appt) if available; fall back to items sent in the payment body.
    // The fallback handles the case where membership was added in the edit UI without saving first,
    // or when the manage_calendar permission blocked the pre-payment PATCH.
    const membershipItemsSrc: Array<any> =
      (appt?.membership_items?.length ? appt.membership_items : null) ??
      (data.membership_items?.length   ? data.membership_items   : null) ??
      [];
    logger.info(`[payments/create] status=${data.status} client_id=${data.client_id} membership_items_src_count=${membershipItemsSrc.length} (db=${appt?.membership_items?.length ?? 0} body=${data.membership_items?.length ?? 0})`);
    if (data.status === 'completed' && data.client_id && membershipItemsSrc.length > 0) {
      for (const item of membershipItemsSrc) {
        const pricePaid = Number(item.price ?? 0) * Number(item.quantity ?? 1);
        // Fire-and-forget — does not block payment return
        (async () => {
          try {
            // Prefer stored membership_id; fall back to name lookup for legacy records
            let membershipId: string | null = item.membership_id ?? null;
            let mem = membershipId
              ? await membershipsRepository.findById(membershipId, data.salon_id)
              : null;
            if (!mem && item.name) {
              mem = await membershipsRepository.findByName(item.name, data.salon_id);
              if (mem) membershipId = mem.id;
            }
            if (!mem || !membershipId) {
              logger.warn(`[payments] could not resolve membership for name="${item.name}" id="${item.membership_id}"`);
              return;
            }
            const totalSessions = mem.sessionType === 'limited' ? (mem.numberOfSessions ?? 0) : 0;
            await clientMembershipsService.autoCreateFromPayment(
              data.salon_id,
              data.client_id!,
              membershipId,
              item.name || mem.name,
              totalSessions,
              pricePaid,
              mem.colour,
              undefined,
              data.appointment_id,
              item.staff_id || appt?.staff_id || undefined,
              checkoutSaleId,
            );
          } catch (err: any) {
            logger.warn('[payments] membership auto-create failed:', err?.message ?? err);
          }
        })();
      }
    }

    // ── Auto-create client_packages when packages are sold ───────────────────
    // package_items only exists on the DB appointment record — unlike
    // membership_items there's no payment-body fallback, since the frontend
    // never sends these directly on a payment.
    const packageItemsSrc: Array<any> = appt?.package_items ?? [];
    // Deliberately NOT gated on 'completed' (unlike memberships/reward points
    // below/above): a client gets their package the moment they put money
    // down, even a part payment, so they can start using it immediately.
    // The package row itself records the real paid/pending split rather than
    // claiming to be settled — and autoCreateFromPayment is idempotent per
    // (appointment, package name), so the later payment that clears the
    // balance settles this same row instead of creating a second package.
    const isBillFullyPaid = data.status === 'completed';
    // Proportional allocation: on a bill that also carries services/products,
    // a part payment isn't earmarked to any one line, so each package is
    // credited the same share of its own total that the bill as a whole has
    // collected. Falls back to fully-paid if the totals aren't usable.
    const billTotalForPkg = Number(data.net_amount) || 0;
    const billPaidFraction = isBillFullyPaid || billTotalForPkg <= 0
      ? 1
      : Math.min(1, Math.max(0, (billTotalForPkg - (Number(data.due_amount) || 0)) / billTotalForPkg));
    if ((data.status === 'completed' || data.status === 'partial') && data.client_id && packageItemsSrc.length > 0) {
      // Awaited (see the Promise.allSettled below), unlike the membership
      // block above which is still fire-and-forget. The client_packages row
      // has to exist before this request returns: the UI refetches
      // /client-packages the moment checkout responds, and when creation ran
      // detached that refetch consistently won the race and came back empty,
      // so a client who had just paid appeared to own no package at all.
      // Only the row insert is awaited — autoCreateFromPayment detaches its
      // own slow tail (auto-scheduling appointments, WhatsApp), so this adds
      // very little to the checkout response time.
      const packageCreations: Array<Promise<void>> = [];
      for (const item of packageItemsSrc) {
        packageCreations.push((async () => {
          try {
            // Prefer a Package Template (has a real per-service session
            // breakdown) — fall back to a plain Catalog package (services
            // list only, no session counts), crediting 1 session per
            // included service since that's what was actually billed.
            let services: Array<{ serviceId?: string; serviceName: string; totalSessions: number; price: number; schedule?: { scheduledAt: string; staffId?: string } }> = [];
            let basePrice      = Number(item.price ?? 0) * Number(item.quantity ?? 1);
            let discount       = 0;
            // Package Templates carry their own precise gst_percentage (set
            // below when one resolves). A plain Catalog package has no tax
            // rate of its own at all — the bill's actual GST on this line was
            // computed client-side from Tax Mapping rules and folded into the
            // appointment total, never broken back out per item. Falling back
            // to the appointment's own blended rate is the same convention
            // reports.repository.ts's unbilled-appointment CTE already uses
            // for the identical "closest rate we actually have" situation,
            // rather than silently leaving this package's own record at 0 GST.
            let gstPercentage  = appt?.gst_percent ?? 0;
            let expiryDate     = "2099-12-31";
            // Set only when a real template resolves and defines an
            // aggregate-session cap ("Expires after this many services") —
            // custom/combo packages have no template to carry this from.
            let expireAfterServices: number | null = null;
            // Denormalized onto client_packages at sale time, same reasoning
            // as client_memberships.description — resolved from whichever of
            // template/combo actually matches below, so it's declared here
            // and filled in by either branch.
            let description: string | null = null;

            const template = item.package_id
              ? await packageTemplatesRepository.findById(item.package_id, data.salon_id)
              : null;
            if (template) {
              basePrice     = template.basePrice;
              discount      = template.discount;
              gstPercentage = template.gstPercentage;
              expireAfterServices = template.expireAfterServices ?? null;
              description   = template.description ?? null;
              if (!template.neverExpires && template.expiryDays != null) {
                const d = new Date();
                d.setDate(d.getDate() + template.expiryDays);
                expiryDate = d.toISOString().slice(0, 10);
              }
            } else if (item.never_expires === false && item.expiry_date) {
              // A custom package built on the spot via "+ Sell Package"
              // (ServicesPanel.tsx's PackageRow, isCustom rows) — no
              // template to resolve an expiry from, but the frontend already
              // carries the real date the staff picked in the builder.
              // "2099-12-31" (the default above) already IS this codebase's
              // established never-expires sentinel, so nothing extra is
              // needed when never_expires is true/absent.
              expiryDate = item.expiry_date;
            }

            // Prefer the frontend's own per-service breakdown when present —
            // it's resolved at package-pick time (see PackageRow.tsx) and is
            // the ONLY place a per-service `schedule` (book a future
            // appointment for this service now) can come from; re-deriving
            // from the template/catalog below would silently drop it.
            // Package-level fields (price/discount/GST/expiry) above still
            // come from the template/catalog lookup regardless — the
            // frontend breakdown only carries per-service name/price/sessions.
            if (item.services?.length) {
              services = item.services.map((s: any) => ({
                serviceId:     s.serviceId || undefined,
                serviceName:   s.serviceName,
                totalSessions: Number(s.totalSessions) || 1,
                price:         Number(s.price) || 0,
                schedule:      s.schedule?.scheduledAt ? { scheduledAt: s.schedule.scheduledAt, staffId: s.schedule.staffId } : undefined,
              }));
            } else if (template) {
              services = template.services.map(s => ({ serviceName: s.serviceName, totalSessions: s.totalSessions, price: s.price }));
            } else {
              const combo = item.package_id
                ? await packagesRepository.findById(item.package_id, data.salon_id)
                : null;
              if (combo) description = combo.description ?? null;
              if (combo && combo.serviceIds.length > 0) {
                const perServicePrice = parseFloat((basePrice / combo.serviceIds.length).toFixed(2));
                for (const svcId of combo.serviceIds) {
                  const svc = await servicesRepository.findById(svcId, data.salon_id);
                  services.push({ serviceId: svcId, serviceName: svc?.name ?? "Service", totalSessions: 1, price: perServicePrice });
                }
                discount = combo.discountType === "fixed"
                  ? combo.discountValue
                  : parseFloat((basePrice * combo.discountValue / 100).toFixed(2));
              }
            }

            if (services.length === 0) {
              logger.warn(`[payments] could not resolve package for name="${item.name}" id="${item.package_id}" — skipping client_package auto-create`);
              return;
            }

            await clientPackagesService.autoCreateFromPayment(
              data.salon_id,
              data.client_id!,
              item.name || "Package",
              services,
              basePrice,
              discount,
              gstPercentage,
              expiryDate,
              expireAfterServices,
              description,
              data.appointment_id,
              item.staff_id || appt?.staff_id || undefined,
              checkoutSaleId,
              requesterUserId,
              billPaidFraction,
              isBillFullyPaid,
            );
          } catch (err: any) {
            logger.warn('[payments] package auto-create failed:', err?.message ?? err);
          }
        })());
      }
      // allSettled, not all — each entry already swallows its own errors, and
      // one package failing must never fail the payment that was collected.
      await Promise.allSettled(packageCreations);
    }

    // Live calendar sync — appointments.service.ts already does this for
    // create/cancel via notificationsService.create() (which also writes a
    // bell notification row). A payment happens far more often than a
    // create/cancel, so this uses a lighter direct socket emit instead —
    // same "push to everyone in the salon room" mechanism, no DB row, no
    // bell spam on every checkout. useBookings.ts listens for this alongside
    // the "notification" event to refetch the visible calendar range.
    try {
      getIO().to(`salon:${data.salon_id}`).emit('payment_updated', {
        appointment_id: data.appointment_id,
        salon_id: data.salon_id,
        // Not persisted anywhere new — carried only on this socket push so a
        // listening Calendar session can skip refetching when this payment's
        // appointment date isn't in its currently-visible range. Omitted
        // (not null) when appt lookup failed, so listeners can fail open.
        ...(appt?.scheduled_at ? { scheduled_at: appt.scheduled_at } : {}),
      });
    } catch {
      // socket not ready — ignore, client will see it on next manual refresh
    }

    return refereeWalletCredit > 0 ? { ...payment, referral_wallet_credited: refereeWalletCredit } : payment;
  },

  async getByAppointmentId(appointmentId: string): Promise<Payment | null> {
    return paymentsRepository.findByAppointmentId(appointmentId);
  },

  async listBySalon(salonId: string): Promise<Payment[]> {
    return paymentsRepository.findBySalonId(salonId);
  },
};