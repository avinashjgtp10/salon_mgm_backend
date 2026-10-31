import { computeBillTotals, rowsTotal, normalizeDiscountAppliesTo, ActiveTaxRow } from "../pricing/pricing.engine";

// Moved verbatim out of appointments.service.ts so callers outside that
// service (e.g. the Payment Machine outstanding-balance check) can reuse the
// same bill-from-stored-inputs calculation without importing the whole service.
// Shared by backfillTaxBreakdown (read-time display) and update() (the
// paid/partial recompute-and-branch decision) in appointments.service.ts —
// both need "what would this appointment's bill actually total, from its raw
// stored inputs."
export function computeAppointmentTotals(appt: {
    services?: any[]; package_items?: any[]; product_items?: any[]; membership_items?: any[];
    discount_type?: string; discount_value?: number; discount_applies_to?: unknown;
    ex_charges?: number; tip_amount?: number; tip_added_to_salon?: boolean;
    include_gst?: boolean; membership_discount_used?: number | string;
}, activeTaxes: ActiveTaxRow[]) {
    const toRow = (items: any[] = []) => (items || []).map((i) => ({
        price: Number(i?.price) || 0,
        // Stored appointment service/item rows use "qty" (see
        // useAppointment.ts::buildServiceApiItems on the frontend) — never
        // "quantity". Reading only .quantity here silently defaulted every
        // row to qty=1, which is why increasing an item's quantity on a
        // paid/partial appointment kept recomputing (and even re-persisting,
        // via update()'s reprice branches below) the bill at its original
        // qty=1 total. payments.service.ts already guards both keys; match
        // that here so this is the one place that needs the fallback.
        qty: Number(i?.quantity) || Number(i?.qty) || 1,
        isPackageService: !!i?.is_package_service,
    }));
    return computeBillTotals({
        actualAmounts: {
            // Package-covered rows are excluded from the taxable base — the
            // customer already paid for those sessions when they bought the
            // package, so this read-time recompute must not tax (or even
            // count) that value again. Mirrors payments.service.ts's own
            // `serviceTotal` filter; without it, this backfill silently
            // taxed the full pre-coverage subtotal on every read where the
            // cached tax_breakdown looked stale (see needsTaxBackfill).
            service:    rowsTotal(toRow(appt.services).filter((r) => !r.isPackageService)),
            packages:   rowsTotal(toRow(appt.package_items)),
            product:    rowsTotal(toRow(appt.product_items)),
            membership: rowsTotal(toRow(appt.membership_items)),
        },
        discountType: (appt.discount_type === "percentage" ? "percentage" : "flat"),
        discountValue: Number(appt.discount_value) || 0,
        // This bill's own "Apply to" selection. NULL on any appointment
        // predating the column, which normalizes to undefined = legacy scope,
        // so a read-time backfill reproduces exactly what that bill was
        // charged instead of re-pricing it under the new rule.
        discountAppliesTo: normalizeDiscountAppliesTo(appt.discount_applies_to),
        // A percentage/loyalty membership discount is a genuine pre-tax price
        // cut, same as the manual discount above — already collected onto
        // this appointment via findById()/listBySalonId()'s payments
        // subquery (MAX per appointment, not a per-call delta). Without this,
        // a read-time backfill (any appointment whose tax_breakdown is empty
        // or stale) recomputed computed_grand_total as if no membership
        // discount had ever been applied, overstating it by exactly that
        // amount — see ComputeBillTotalsInput.membershipDiscountAmount for
        // why this must go directly into grandTotal, not the discRatio.
        membershipDiscountAmount: Number(appt.membership_discount_used) || 0,
        // Respect this appointment's own persisted "Include GST" choice —
        // without this gate, a bill deliberately saved with GST excluded
        // gets the salon's active taxes silently added back in on every
        // read-time backfill/reprice (see include_gst on the Appointment type).
        taxes: appt.include_gst === false ? [] : activeTaxes,
        exCharges: Number(appt.ex_charges) || 0,
        tip: Number(appt.tip_amount) || 0,
        tipAddedToSalon: !!appt.tip_added_to_salon,
    });
}
