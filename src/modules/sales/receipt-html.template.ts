import { Sale, SaleItem } from "./sales.types";

// Ported from the dashboard's ViewBillModal.tsx `printReceipt()` — same visual
// invoice staff see when they print/save a bill, adapted from the frontend's
// Booking-shaped data to the backend's Sale/SaleItem records. One real gap:
// the backend only stores a single blended tax_amount (no CGST/SGST split),
// so tax renders as one "Tax" line instead of itemized per-tax-type rows.
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
    client: { name: string; phone: string | null; email: string | null };
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
}): string {
    const { salon, salonAddress, client, sale, items, staffNames, appointment, paidAmount, dueAmount, couponCode } = params;

    const findStaffName = (id: string | null) => (id && staffNames[id]) || "";

    const salonName = salon.business_name || "Salon";
    const salonPhone = salon.phone || "";
    const salonEmail = salon.email || "";
    const salonWebsite = salon.website_url || "";
    const gst = salon.gst_number || "";
    const logoUrl = salon.logo_url || "";

    const now = new Date();
    const printDate = now.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
    const printTime = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const invoiceNo = sale.invoice_number ?? sale.id.slice(0, 8).toUpperCase();

    const formatTime12 = (iso: string) =>
        new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

    const apptDate = appointment
        ? new Date(appointment.scheduledAt).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })
        : "—";
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

    const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

    const allItemRows = items
        .map((item, idx) => {
            const type = TYPE_LABEL[item.item_type] ?? item.item_type;
            const [badgeBg, badgeColor] = BADGE[type] ?? ["#f3f4f6", "#374151"];
            const rowBg = idx % 2 === 0 ? "#f9fafb" : "#ffffff";
            const discount = Number(item.discount_amount) || 0;
            return `
    <tr style="background:${rowBg};-webkit-print-color-adjust:exact;print-color-adjust:exact">
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;color:#6b7280;font-size:11px">${idx + 1}</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:12px">${item.name}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center">
        <span style="display:inline-block;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;background:${badgeBg};color:${badgeColor};letter-spacing:0.3px;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact">${type}</span>
      </td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;font-size:11px;color:#374151">${findStaffName(item.staff_id) || "—"}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;font-size:12px;color:#111827">${item.quantity}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:right;font-size:12px;color:#111827">${fmt(Number(item.unit_price))}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:right;font-size:12px;color:${discount > 0 ? "#dc2626" : "#9ca3af"}">${discount > 0 ? `−${fmt(discount)}` : "—"}</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:12px;color:#111827">${fmt(Number(item.total_price))}</td>
    </tr>`;
        })
        .join("");

    const sumRow = (label: string, value: string, bold = false, color = "#111827", borderDouble = false) =>
        `<tr>
      <td style="padding:6px 12px;font-size:12px;font-weight:${bold ? 700 : 500};color:${color};border:1px solid #e5e7eb;${borderDouble ? "border-top:2px solid #111827;" : ""}">${label}</td>
      <td style="padding:6px 12px;text-align:right;font-size:12px;font-weight:${bold ? 700 : 500};color:${color};border:1px solid #e5e7eb;${borderDouble ? "border-top:2px solid #111827;" : ""}">${value}</td>
    </tr>`;

    const subtotalAmt = Number(sale.subtotal) || 0;
    const discountAmt = Number(sale.discount_amount) || 0;
    const tipAmt = Number(sale.tip_amount) || 0;
    const taxAmt = Number(sale.tax_amount) || 0;
    const grandTotal = Number(sale.total_amount) || 0;

    const summaryRows = [
        subtotalAmt > 0 ? sumRow("Subtotal", fmt(subtotalAmt)) : "",
        discountAmt > 0 ? sumRow(couponCode ? `Coupon (${couponCode})` : "Discount", `−${fmt(discountAmt)}`, false, "#dc2626") : "",
        tipAmt > 0 ? sumRow("Tip (Staff)", `+${fmt(tipAmt)}`) : "",
        // No CGST/SGST split is stored server-side, so tax is a single blended line
        // rather than the dashboard's itemized per-tax-type breakdown.
        taxAmt > 0 ? sumRow("Tax", `+${fmt(taxAmt)}`) : "",
        sumRow("Grand Total", fmt(grandTotal), true, "#111827", true),
        paidAmount > 0 ? sumRow("Amount Paid", fmt(paidAmount), false, "#15803d") : "",
        dueAmount > 0 ? sumRow("Balance Due", fmt(dueAmount), true, "#dc2626") : "",
    ]
        .filter(Boolean)
        .join("");

    const infoCell = (label: string, value: string) =>
        `<div style="margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;margin-bottom:2px">${label}</div>
      <div style="font-size:12px;font-weight:600;color:#111827;line-height:1.4">${value || "—"}</div>
    </div>`;

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
  .inv-salon-meta{font-size:10.5px;color:#6b7280;line-height:1.8}
  .inv-salon-meta span{display:block}
  .inv-title-block{text-align:right;flex-shrink:0}
  .inv-title-word{font-size:26px;font-weight:800;color:#111827;text-transform:uppercase;letter-spacing:2px;line-height:1}
  .inv-meta-table{margin-top:10px;font-size:11px;color:#374151;border-collapse:collapse}
  .inv-meta-table td{padding:2px 0 2px 16px;text-align:right}
  .inv-meta-table td:first-child{color:#6b7280;font-weight:600;text-transform:uppercase;font-size:9.5px;letter-spacing:0.4px;padding-left:0;text-align:left}

  .inv-info{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e5e7eb}
  .inv-info-col{padding:16px 32px}
  .inv-info-col+.inv-info-col{border-left:1px solid #e5e7eb}
  .inv-section-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#111827;background:#f3f4f6;display:inline-block;padding:2px 8px;border-radius:3px;margin-bottom:12px}
  .inv-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}

  .pay-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;border:1px solid currentColor}

  .inv-table-section{padding:0 32px 20px}
  .inv-section-header{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#111827;margin:18px 0 10px;padding-bottom:5px;border-bottom:2px solid #111827}
  table.inv-table{width:100%;border-collapse:collapse;font-size:11.5px}
  table.inv-table thead th{padding:8px 10px;background:#f9fafb;color:#111827;font-size:9.5px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;border:1px solid #d1d5db;white-space:nowrap}
  table.inv-table thead th:nth-child(1){text-align:center;width:36px}
  table.inv-table thead th:nth-child(2){text-align:left}
  table.inv-table thead th:nth-child(3){text-align:center}
  table.inv-table thead th:nth-child(4){text-align:center}
  table.inv-table thead th:nth-child(5){text-align:center;width:36px}
  table.inv-table thead th:nth-child(6){text-align:right}
  table.inv-table thead th:nth-child(7){text-align:right}
  table.inv-table thead th:nth-child(8){text-align:right}
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
  .inv-footer-center{font-size:10px;color:#6b7280;text-align:center;line-height:1.8}
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
      </div>
    </div>
    <div class="inv-info-col">
      <div class="inv-section-label">Appointment Details</div>
      <div class="inv-info-grid">
        ${infoCell("Date", apptDate)}
        ${infoCell("Time", apptTime)}
        ${infoCell("Staff", allStaffDisplay)}
        ${infoCell("Payment Method", (sale.payment_method ?? "—").toUpperCase())}
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
          <th>#</th><th>Item Name</th><th>Type</th><th>Staff</th><th>Qty</th><th>Rate</th><th>Disc.</th><th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${allItemRows || `<tr><td colspan="8" style="text-align:center;padding:20px;color:#9ca3af;border:1px solid #e5e7eb">No items</td></tr>`}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="7" style="text-align:right;padding:8px 12px;font-size:11px;color:#374151">Items Total</td>
          <td style="text-align:right;padding:8px 12px;font-weight:700;color:#111827">${fmt(subtotalAmt || grandTotal)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="inv-bottom">
    <div>
      ${appointment?.notes ? `<div class="inv-notes"><div class="inv-notes-title">Notes</div>${appointment.notes}</div>` : ""}
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
    <div class="inv-footer-center">
      ${[salonPhone, salonEmail].filter(Boolean).join(" &nbsp;|&nbsp; ")}<br>
      ${salonAddress || ""}
      ${gst ? `<br>GSTIN: ${gst}` : ""}
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
