import { Sale, SaleItem, TipBreakdownEntry } from "./sales.types";
import { TaxBreakdownEntry } from "../payments/payments.types";
import config from "../../config/env";

// Ported from the dashboard's ViewBillModal.tsx `printReceipt()` — same visual
// invoice staff see when they print/save a bill from the Calendar, adapted
// from the frontend's Booking-shaped data to the backend's Sale/SaleItem/
// Payment records. Kept in parity deliberately: every field the calendar
// print shows (referral code/earnings, active packages/memberships,
// itemized tax, wallet/points/credit redemption lines, package-covered
// handling, round-off, per-staff tip) is rendered here too, from the same
// already-computed figures the calendar reads — this never recomputes
// pricing itself, it only renders numbers the caller already trusts.
export function buildReceiptHtml(params: {
    salon: {
        business_name: string;
        logo_url: string | null;
        email: string | null;
        phone: string | null;
        website_url: string | null;
        gst_number: string | null;
    };
    salonAddress: string | null;
    client: {
        name: string;
        phone: string | null;
        email: string | null;
        gst_number?: string | null;
        referral_code?: string | null;
        referral_earnings?: number | null;
    };
    activePackages?: Array<{ packageName: string; remaining: number; total: number }>;
    activeMemberships?: Array<{ membershipName: string; expiresAt: string | null }>;
    sale: Sale;
    items: SaleItem[];
    staffNames: Record<string, string>;
    appointment: {
        id: string;
        scheduledAt: string;
        durationMinutes: number;
        status: string;
        notes: string | null;
    } | null;
    paidAmount: number;
    dueAmount: number;
    couponCode: string | null;
    taxBreakdown?: TaxBreakdownEntry[] | null;
    membershipWalletUsed?: number;
    membershipDiscountUsed?: number;
    ewalletUsed?: number;
    rewardPointsValue?: number;
    referralCreditUsed?: number;
    packageCoveredAmount?: number;
}): string {
    const {
        salon, salonAddress, client, sale, items, staffNames, appointment, paidAmount, dueAmount, couponCode,
        activePackages = [], activeMemberships = [],
    } = params;

    const findStaffName = (id: string | null) => (id && staffNames[id]) || "";

    const salonName = salon.business_name || "Salon";
    const salonPhone = salon.phone || "";
    const salonEmail = salon.email || "";
    const salonWebsite = salon.website_url || "";
    const gst = salon.gst_number || "";
    // Puppeteer renders this via page.setContent() (no navigation, so no base
    // URL to resolve a relative src against) — and runs on this same backend
    // process, so localhost is always reachable here regardless of whether a
    // public tunnel/LAN address is up. A legacy row still holding an old
    // absolute URL (ngrok/S3) is left as-is.
    const rawLogoUrl = salon.logo_url || "";
    const logoUrl = rawLogoUrl.startsWith("/")
        ? `http://localhost:${config.port}${rawLogoUrl}`
        : rawLogoUrl;

    // Puppeteer runs on the backend server, which isn't guaranteed to be in
    // IST (commonly UTC on cloud hosts) — unlike the Calendar print, which
    // runs in the salon owner's own (India-based) browser and gets IST for
    // free from the system clock. Every date/time below pins timeZone:
    // "Asia/Kolkata" explicitly so the WhatsApp PDF always shows the same
    // wall-clock time as the Calendar one, regardless of the server's TZ.
    const IST = "Asia/Kolkata";
    const now = new Date();
    const printDate = now.toLocaleDateString("en-IN", { timeZone: IST, year: "numeric", month: "long", day: "numeric" });
    const printTime = now.toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit" });
    const invoiceNo = sale.invoice_number ?? "Not billed yet";

    const formatTime12 = (iso: string) =>
        new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });

    const apptDate = appointment
        ? new Date(appointment.scheduledAt).toLocaleDateString("en-IN", { timeZone: IST, year: "numeric", month: "long", day: "numeric" })
        : "—";
    const apptStartTime = appointment ? formatTime12(appointment.scheduledAt) : null;
    const apptTime = appointment
        ? `${formatTime12(appointment.scheduledAt)} – ${formatTime12(new Date(new Date(appointment.scheduledAt).getTime() + appointment.durationMinutes * 60000).toISOString())}`
        : "—";

    const rawPs = dueAmount > 0 ? "Partial" : "Paid";
    const PAY_COLOR: Record<string, string> = { Paid: "#15803d", Partial: "#7c3aed", Unpaid: "#b45309" };
    const PAY_BG: Record<string, string> = { Paid: "#dcfce7", Partial: "#ede9fe", Unpaid: "#fef3c7" };
    const payColor = PAY_COLOR[rawPs] ?? "#b45309";
    const payBg = PAY_BG[rawPs] ?? "#fef3c7";

    const allStaffIds = Array.from(new Set(items.map((i) => i.staff_id).filter(Boolean))) as string[];
    const allStaffDisplay = allStaffIds.map((id) => findStaffName(id)).filter(Boolean).join(", ") || "—";

    // Every amount on the printed page goes through this — the previous
    // version of this file never prepended a currency symbol at all, so
    // every figure on the WhatsApp-sent PDF read as a bare number.
    const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // A package-covered visit collects no new money (the package's price was
    // already booked as revenue at purchase time) — same isPackagePaid
    // detection the calendar print uses, so a session paid entirely from a
    // package's included sessions prints "Package Covered" and zeroes the
    // bill here too, instead of showing the full price as newly charged.
    const packageCoveredAmt = Number(params.packageCoveredAmount ?? 0);
    const isPackagePaid = packageCoveredAmt > 0;

    const TYPE_LABEL: Record<string, string> = {
        service: "Service",
        product: "Product",
        membership: "Membership",
        gift_card: "Gift Card",
        quick: "Quick Sale",
    };
    const BADGE: Record<string, [string, string]> = {
        Service: ["#ede9fe", "#5b21b6"],
        Product: ["#dbeafe", "#1d4ed8"],
        Membership: ["#dcfce7", "#15803d"],
        "Gift Card": ["#fef3c7", "#92400e"],
        "Quick Sale": ["#f3f4f6", "#374151"],
    };

    const taxBreakdown = params.taxBreakdown ?? [];
    const taxLabel = taxBreakdown.length > 0
        ? taxBreakdown.map((t) => `${t.name} ${t.rate}%`).join(" + ")
        : "Tax";

    // Running sum of every row's gross (tax-inclusive) amount, read back by
    // the "Items Total" footer — same reconciliation the calendar print does,
    // instead of the previous version's footer which just repeated the
    // overall subtotal/grand-total regardless of what the rows actually add
    // up to.
    let grossItemsTotal = 0;
    const allItemRows = items
        .map((item, idx) => {
            const type = TYPE_LABEL[item.item_type] ?? item.item_type;
            const [badgeBg, badgeColor] = BADGE[type] ?? ["#f3f4f6", "#374151"];
            const rowBg = idx % 2 === 0 ? "#f9fafb" : "#ffffff";
            const discount = Number(item.discount_amount) || 0;
            const rowTax = Number(item.tax_amount) || 0;
            const total = isPackagePaid ? 0 : Number(item.total_price) || 0;
            const grossAmount = total + rowTax;
            grossItemsTotal += grossAmount;
            return `
    <tr style="background:${rowBg};-webkit-print-color-adjust:exact;print-color-adjust:exact">
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;color:#6b7280;font-size:11px">${idx + 1}</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:12px">${item.name}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center">
        <span style="display:inline-block;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;background:${badgeBg};color:${badgeColor};letter-spacing:0.3px;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact">${type}</span>
      </td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;font-size:11px;color:#374151">${findStaffName(item.staff_id) || "—"}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;font-size:11px;color:#374151">${apptStartTime || "—"}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;font-size:12px;color:#111827">${item.quantity}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:right;font-size:12px;color:#111827">${fmt(Number(item.unit_price))}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:right;font-size:12px;color:${discount > 0 ? "#dc2626" : "#9ca3af"}">${discount > 0 ? `−${fmt(discount)}` : "—"}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:right;font-size:11px;color:#374151">
        ${rowTax > 0 ? `${fmt(rowTax)}<div style="font-size:9px;color:#9ca3af;margin-top:1px">${taxLabel}</div>` : "—"}
      </td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:12px;color:#111827">${fmt(grossAmount)}</td>
    </tr>`;
        })
        .join("");

    const sumRow = (label: string, value: string, bold = false, color = "#111827", borderDouble = false) =>
        `<tr>
      <td style="padding:6px 12px;font-size:12px;font-weight:${bold ? 700 : 500};color:${color};border:1px solid #e5e7eb;${borderDouble ? "border-top:2px solid #111827;" : ""}">${label}</td>
      <td style="padding:6px 12px;text-align:right;font-size:12px;font-weight:${bold ? 700 : 500};color:${color};border:1px solid #e5e7eb;${borderDouble ? "border-top:2px solid #111827;" : ""}">${value}</td>
    </tr>`;

    // ── Payment summary ───────────────────────────────────────────────────────
    const itemsCatalogTotal = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 1), 0);
    const itemsNetTotal = items.reduce((s, i) => s + (Number(i.total_price) || 0), 0);
    const itemDiscountAmt = Math.max(0, itemsCatalogTotal - itemsNetTotal);

    const subtotalAmt = Number(sale.subtotal) || 0;
    const manualDisc = Number(sale.manual_discount_amount) || 0;
    const couponDisc = Number(sale.coupon_discount_amount) || 0;
    const resolvedCouponCode = couponCode || sale.coupon_code || "";
    const referralDisc = Number(sale.referral_discount_amount) || 0;
    const membershipDiscountAmt = Number(params.membershipDiscountUsed ?? 0);
    const exCharges = Number(sale.ex_charges) || 0;
    const tipAmt = Number(sale.tip_amount) || 0;
    const tipBreakdown: TipBreakdownEntry[] = sale.tip_breakdown ?? [];
    const membershipWalletUsedAmt = Number(params.membershipWalletUsed ?? 0);
    const ewalletUsedAmt = Number(params.ewalletUsed ?? 0);
    const rewardPointsValuePaid = Number(params.rewardPointsValue ?? 0);
    const referralCreditUsedAmt = Number(params.referralCreditUsed ?? 0);

    const exclusiveTaxTotal = taxBreakdown.length > 0
        ? taxBreakdown.filter((t) => !t.inclusive && t.amount > 0).reduce((s, t) => s + t.amount, 0)
        : Number(sale.tax_amount) || 0;

    // sale.total_amount is the revenue figure (tip-exclusive — matches every
    // dashboard/report reading of this same column). The printed Grand Total
    // is what the client actually paid, so tip is added back on here only,
    // display-side.
    const grandTotal = isPackagePaid ? 0 : (Number(sale.total_amount) || 0) + tipAmt;

    // Same waterfall identity totalsUtils.ts/the calendar print uses,
    // flattened into one pass — every term here is a figure already computed
    // by the caller (never re-derived), so this is purely a display
    // reconciliation, not a re-run of pricing logic.
    const rawGrandTotal = subtotalAmt - couponDisc - membershipDiscountAmt - packageCoveredAmt + exclusiveTaxTotal
        - manualDisc + exCharges + tipAmt - referralDisc
        - membershipWalletUsedAmt - ewalletUsedAmt - rewardPointsValuePaid - referralCreditUsedAmt;
    const roundOff = grandTotal - rawGrandTotal;

    // A split payment stores its real per-method breakdown as JSON in
    // sales.payment_reference — {"Cash":600,"UPI":660}, written by
    // normalizePaymentMethod() in transactions/payment-method.util.ts. Keys
    // can also be "Package"/"Membership"/"eWallet" when those covered part of
    // the bill.
    const METHOD_LABELS: Record<string, string> = {
        cash: "Cash", card: "Card", upi: "UPI", wallet: "E-Wallet", ewallet: "E-Wallet",
        gift_card: "Gift Card", package: "Package", membership: "Membership",
        pos_machine: "Payment Machine",
    };
    const prettyMethod = (raw: string) =>
        METHOD_LABELS[raw.trim().toLowerCase()]
        ?? raw.trim().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    // Per-payment-method breakdown, real-money legs only — mirrors the
    // frontend's paymentUtils.ts getPaymentMethodBreakdown() so the WhatsApp
    // PDF and the dashboard side panel can never show different figures for
    // the same booking. eWallet is deliberately excluded: paidAmount already
    // excludes it too (it's a pre-payment credit tracked by its own separate
    // "eWallet Used" deduction line above), so these legs always sum to
    // exactly paidAmount.
    const splitLegs: Array<{ label: string; amount: number }> = (() => {
        if ((sale.payment_method ?? "").trim().toLowerCase() === "split") {
            try {
                const parsed = JSON.parse(sale.payment_reference ?? "") as Record<string, unknown>;
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    const legs = Object.entries(parsed)
                        .map(([key, value]) => ({ label: prettyMethod(key), amount: Number(value) || 0 }))
                        .filter((leg) => leg.amount > 0 && leg.label.toLowerCase() !== "e-wallet");
                    if (legs.length > 0) return legs;
                }
            } catch {
                // falls through to the single-method case below
            }
        }
        // Plain single-method payment (or a "split" record whose reference
        // didn't parse) — the one real method is only known from
        // payment_method, paired with the actual amount paid.
        const method = (sale.payment_method ?? "").trim().toLowerCase();
        if (method && !["package", "split", "ewallet", "wallet"].includes(method) && paidAmount > 0) {
            return [{ label: prettyMethod(method), amount: paidAmount }];
        }
        return [];
    })();

    const summaryRows = [
        itemDiscountAmt > 0 ? sumRow("Items Total", fmt(itemsCatalogTotal)) : "",
        itemDiscountAmt > 0 ? sumRow("Item Discount", `−${fmt(itemDiscountAmt)}`, false, "#dc2626") : "",
        subtotalAmt > 0 ? sumRow("Subtotal", fmt(subtotalAmt)) : "",
        couponDisc > 0 ? sumRow(resolvedCouponCode ? `Coupon (${resolvedCouponCode})` : "Coupon", `−${fmt(couponDisc)}`, false, "#dc2626") : "",
        packageCoveredAmt > 0 ? sumRow("Package Covered", `−${fmt(packageCoveredAmt)}`, false, "#7c3aed") : "",
        membershipDiscountAmt > 0 ? sumRow("Membership Discount", `−${fmt(membershipDiscountAmt)}`, false, "#dc2626") : "",
        // Itemized per-tax lines (CGST/SGST/etc.) + a "Total Tax" subtotal when
        // the caller provided a real breakdown; falls back to the single
        // blended "Tax" line (sale.tax_amount) when it didn't — same fallback
        // the calendar print itself uses for a bill saved before per-tax
        // breakdown existed.
        ...(taxBreakdown.length > 0
            ? [
                ...taxBreakdown
                    .filter((t) => t.amount > 0)
                    .map((t) => sumRow(`${t.name} ${t.rate}%${t.inclusive ? " (incl.)" : ""}`, `${t.inclusive ? "" : "+"}${fmt(t.amount)}`)),
                sumRow("Total Tax", fmt(taxBreakdown.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0))),
            ]
            : [exclusiveTaxTotal > 0 ? sumRow("Tax", `+${fmt(exclusiveTaxTotal)}`) : ""]),
        exCharges > 0 ? sumRow("Extra Charges", `+${fmt(exCharges)}`) : "",
        manualDisc > 0 ? sumRow("Bill Discount", `−${fmt(manualDisc)}`, false, "#dc2626") : "",
        referralDisc > 0 ? sumRow("Referral Discount", `−${fmt(referralDisc)}`, false, "#dc2626") : "",
        rewardPointsValuePaid > 0 ? sumRow("Reward Points Used", `−${fmt(rewardPointsValuePaid)}`, false, "#7c3aed") : "",
        membershipWalletUsedAmt > 0 ? sumRow("Membership Wallet Used", `−${fmt(membershipWalletUsedAmt)}`, false, "#15803d") : "",
        ewalletUsedAmt > 0 ? sumRow("eWallet Used", `−${fmt(ewalletUsedAmt)}`, false, "#2563eb") : "",
        referralCreditUsedAmt > 0 ? sumRow("Referral Credit Used", `−${fmt(referralCreditUsedAmt)}`, false, "#0891b2") : "",
        !isPackagePaid && Math.abs(roundOff) >= 0.005
            ? sumRow("Round Off", `${roundOff >= 0 ? "+" : "−"}${fmt(Math.abs(roundOff))}`)
            : "",
        sumRow("Grand Total", fmt(grandTotal), true, "#111827", true),
        sumRow("Amount to Pay", fmt(grandTotal), true, "#111827"),
        tipAmt > 0 ? sumRow("Staff Tip (included above)", fmt(tipAmt), false, "#6b7280") : "",
        tipAmt > 0 ? tipBreakdown.map((t) => sumRow(`&nbsp;&nbsp;&nbsp;${t.staff_name}`, fmt(Number(t.amount) || 0), false, "#9ca3af")).join("") : "",
        splitLegs.length > 0
            ? splitLegs.map((leg) => sumRow(`Paid via ${leg.label}`, fmt(leg.amount), false, "#111827")).join("")
            : "",
        paidAmount > 0
            ? sumRow(splitLegs.length > 1 ? "Total Amount Paid" : "Amount Paid", fmt(paidAmount), false, "#15803d")
            : "",
        dueAmount > 0 ? sumRow("Balance Due", fmt(dueAmount), true, "#dc2626") : "",
    ]
        .filter(Boolean)
        .join("");

    const infoCell = (label: string, value: string) =>
        `<div style="margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;margin-bottom:2px">${label}</div>
      <div style="font-size:12px;font-weight:600;color:#111827;line-height:1.4">${value || "—"}</div>
    </div>`;

    const fmtDate = (raw: string | null) => {
        if (!raw) return "";
        const d = new Date(raw);
        return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { timeZone: IST, year: "numeric", month: "short", day: "2-digit" });
    };
    const primaryMembershipName = activeMemberships[0]?.membershipName || "";
    const clientGst = client.gst_number || "";
    const referralCode = client.referral_code || null;
    const referralEarnings = client.referral_earnings ?? null;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${invoiceNo} — ${salonName}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#111827;background:#fff}
  .page{width:210mm;min-height:297mm;background:#ffffff;display:flex;flex-direction:column}

  .inv-topbar{display:flex;justify-content:space-between;align-items:flex-start;padding:28px 32px 20px;border-bottom:2px solid #111827}
  .inv-logo{width:68px;height:68px;border-radius:8px;object-fit:cover;border:1px solid #e5e7eb;flex-shrink:0}
  .inv-logo-placeholder{width:68px;height:68px;border-radius:8px;background:#f3f4f6;border:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:#374151;flex-shrink:0}
  .inv-salon-block{display:flex;align-items:flex-start;gap:14px}
  .inv-salon-name{font-size:20px;font-weight:800;color:#111827;letter-spacing:-0.3px;margin-bottom:4px}
  .inv-salon-meta{font-size:10.5px;color:#6b7280;line-height:1.8;max-width:360px}
  .inv-salon-meta span{display:block;word-break:break-word}
  .inv-title-block{text-align:right;flex-shrink:0}
  .inv-title-word{font-size:26px;font-weight:800;color:#111827;text-transform:uppercase;letter-spacing:2px;line-height:1}
  .inv-meta-table{margin-top:10px;font-size:11px;color:#374151;border-collapse:collapse}
  .inv-meta-table td{padding:2px 0 2px 16px;text-align:right}
  .inv-meta-table td:first-child{color:#6b7280;font-weight:600;text-transform:uppercase;font-size:9.5px;letter-spacing:0.4px;padding-left:0;text-align:left}

  .inv-info{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e5e7eb}
  .inv-info-col{padding:16px 32px}
  .inv-info-col+.inv-info-col{border-left:1px solid #e5e7eb}
  .inv-section-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#111827;background:#f3f4f6;display:inline-block;padding:2px 8px;border-radius:3px;margin-bottom:12px}
  .inv-info-grid{display:grid;grid-template-columns:1fr;gap:0}

  .pay-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;border:1px solid currentColor}

  .inv-table-section{padding:0 32px 20px}
  .inv-section-header{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#111827;margin:18px 0 10px;padding-bottom:5px;border-bottom:2px solid #111827}
  table.inv-table{width:100%;border-collapse:collapse;font-size:11.5px}
  table.inv-table thead th{padding:8px 10px;background:#f9fafb;color:#111827;font-size:9.5px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;border:1px solid #d1d5db;white-space:nowrap}
  table.inv-table thead th:nth-child(1){text-align:center;width:36px}
  table.inv-table thead th:nth-child(2){text-align:left}
  table.inv-table thead th:nth-child(3){text-align:center}
  table.inv-table thead th:nth-child(4){text-align:center}
  table.inv-table thead th:nth-child(5){text-align:center}
  table.inv-table thead th:nth-child(6){text-align:center;width:36px}
  table.inv-table thead th:nth-child(7){text-align:right}
  table.inv-table thead th:nth-child(8){text-align:right}
  table.inv-table thead th:nth-child(9){text-align:right}
  table.inv-table tbody td{border:1px solid #e5e7eb}
  table.inv-table tfoot td{padding:8px 12px;font-size:11.5px;font-weight:700;color:#111827;border:1px solid #d1d5db;background:#f9fafb}

  .inv-bottom{display:grid;grid-template-columns:1fr auto;gap:32px;padding:0 32px 24px;align-items:start}
  .inv-notes{font-size:11px;color:#374151;line-height:1.7;border:1px solid #e5e7eb;border-radius:4px;padding:10px 14px}
  .inv-notes-title{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#374151;margin-bottom:5px}
  .inv-summary-table{width:240px;border-collapse:collapse}
  .inv-summary-table td{padding:6px 12px;font-size:12px;border:1px solid #e5e7eb;color:#111827}

  .inv-footer{margin-top:auto;border-top:2px solid #111827;padding:16px 32px 18px;display:flex;justify-content:space-between;align-items:center;gap:16px}
  .inv-footer-left{font-size:12px;color:#111827}
  .inv-footer-left strong{font-size:13px;font-weight:800}
  .inv-footer-right{font-size:10px;color:#6b7280;text-align:right;line-height:1.8}
</style>
</head>
<body>
<div class="page">
  <div class="inv-topbar">
    <div class="inv-salon-block">
      ${logoUrl
        ? `<img class="inv-logo" src="${logoUrl}" alt="${salonName}">`
        : `<div class="inv-logo-placeholder">${salonName.charAt(0).toUpperCase()}</div>`}
      <div>
        <div class="inv-salon-name">${salonName}</div>
        <div class="inv-salon-meta">
          ${salonAddress ? `<span>${salonAddress}</span>` : ""}
          ${salonPhone ? `<span>Ph: ${salonPhone}</span>` : ""}
          ${salonEmail ? `<span>${salonEmail}</span>` : ""}
          ${salonWebsite ? `<span>${salonWebsite}</span>` : ""}
          ${gst ? `<span>GSTIN: ${gst}</span>` : ""}
        </div>
      </div>
    </div>
    <div class="inv-title-block">
      <div class="inv-title-word">Invoice</div>
      <table class="inv-meta-table">
        <tr><td>Invoice No</td><td><strong>${invoiceNo}</strong></td></tr>
        ${appointment ? `<tr><td>Booking #</td><td>${appointment.id.slice(0, 8).toUpperCase()}</td></tr>` : ""}
        <tr><td>Date</td><td>${printDate}</td></tr>
        <tr><td>Time</td><td>${printTime}</td></tr>
      </table>
    </div>
  </div>

  <div class="inv-info">
    <div class="inv-info-col">
      <div class="inv-section-label">Bill To</div>
      <div class="inv-info-grid">
        ${infoCell("Name", client.name || "Walk-In")}
        ${infoCell("Phone", client.phone || "—")}
        ${infoCell("Email", client.email || "—")}
        ${clientGst ? infoCell("GST No", clientGst) : ""}
        ${primaryMembershipName ? infoCell("Membership", primaryMembershipName) : ""}
        ${referralCode ? infoCell("Your Referral Code", referralCode) : ""}
        ${referralEarnings !== null ? infoCell("Referral Earnings", fmt(Number(referralEarnings))) : ""}
      </div>
    </div>
    <div class="inv-info-col">
      <div class="inv-section-label">Appointment Details</div>
      <div class="inv-info-grid">
        ${infoCell("Date", apptDate)}
        ${infoCell("Time", apptTime)}
        ${infoCell("Staff", allStaffDisplay)}
        ${infoCell("Payment Method", splitLegs.length > 0
            ? splitLegs.map((leg) => leg.label).join(" + ").toUpperCase()
            : (sale.payment_method ?? "—").toUpperCase())}
        ${infoCell("Booking Status", appointment?.status ?? "Completed")}
        ${infoCell("Payment Status", `<span class="pay-badge" style="background:${payBg};color:${payColor}">${rawPs}</span>`)}
      </div>
    </div>
  </div>

  <div class="inv-table-section">
    <div class="inv-section-header">Services &amp; Items</div>
    <table class="inv-table">
      <thead>
        <tr>
          <th>#</th><th>Item Name</th><th>Type</th><th>Staff</th><th>Time</th><th>Qty</th><th>Rate</th><th>Disc.</th><th>Tax</th><th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${allItemRows || `<tr><td colspan="10" style="text-align:center;padding:20px;color:#9ca3af;border:1px solid #e5e7eb">No items</td></tr>`}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="9" style="text-align:right;padding:8px 12px;font-size:11px;color:#374151">Items Total</td>
          <td style="text-align:right;padding:8px 12px;font-weight:700;color:#111827">${fmt(grossItemsTotal)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="inv-bottom">
    <div>
      ${appointment?.notes ? `<div class="inv-notes"><div class="inv-notes-title">Notes</div>${appointment.notes}</div>` : ""}
      ${activePackages.length > 0 ? `<div class="inv-notes" style="margin-top:8px"><div class="inv-notes-title">Active Packages</div>${activePackages.map((p) => `${p.packageName} — ${p.remaining}/${p.total} sessions left`).join("<br>")}</div>` : ""}
      ${activeMemberships.length > 0 ? `<div class="inv-notes" style="margin-top:8px"><div class="inv-notes-title">Active Memberships</div>${activeMemberships.map((m) => `${m.membershipName}${m.expiresAt ? ` — Expires: ${fmtDate(m.expiresAt)}` : ""}`).join("<br>")}</div>` : ""}
    </div>
    <div>
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#111827;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid #111827">Payment Summary</div>
      <table class="inv-summary-table">
        <tbody>${summaryRows}</tbody>
      </table>
    </div>
  </div>

  <div class="inv-footer">
    <div class="inv-footer-left">
      <strong>Thank you for choosing ${salonName}!</strong><br>
      <span style="font-size:11px;color:#6b7280">We look forward to seeing you again.</span>
    </div>
    <div class="inv-footer-right">
      This is a computer-generated receipt.<br>
      No signature required.<br>
      <strong style="color:#374151;font-size:11px">Powered by Salonox</strong>
    </div>
  </div>
</div>
</body>
</html>`;
}
