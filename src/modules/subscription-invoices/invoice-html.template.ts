// Server-side HTML for the subscription tax-invoice PDF (seller, Bill To, one subscription line, CGST/SGST split,
// amount in words, bank details).

export interface InvoicePrintPayload {
    invoice: {
        invoice_no: string;
        issued_at: string;
        plan_label: string;
        plan_name: string | null;
        payment_mode: string | null;
        transaction_id: string | null;
        status: string;
        subtotal: number;
        gst_percent: number;
        gst_amount: number;
        total: number;
        period_start: string | null;
        period_end: string | null;
        /** Unused value of the previous plan that was credited (upgrades). */
        credit?: number;
        /** One line describing what this invoice is for, e.g. an upgrade from Advance to Growth. */
        description?: string | null;
    };
    customer: { salon_name: string; address: string | null; contact: string | null; email: string | null };
    seller: {
        name: string; address: string; contact: string; email: string; gst_number: string; pan: string;
        bank_name: string; bank_branch: string; bank_account_number: string; bank_ifsc: string; bank_account_type: string;
    };
    amount_in_words: string;
}

const money = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dShort = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const dLong = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
const esc = (s: string | null | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildInvoiceHtml(p: InvoicePrintPayload): string {
    const { invoice, customer, seller, amount_in_words } = p;
    // An invoice without GST (0%) is a plain invoice: no tax lines, and the seller's GST number isn't printed.
    const withGst = invoice.gst_percent > 0;
    const half = invoice.gst_percent / 2;
    const cgst = invoice.gst_amount / 2;
    const sgst = invoice.gst_amount - cgst;
    const period = invoice.period_start && invoice.period_end ? `${dShort(invoice.period_start)} - ${dShort(invoice.period_end)}` : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; font-size: 12px; }
  .doc { max-width: 760px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; }
  .top-row { display: flex; justify-content: flex-end; margin-bottom: 18px; }
  .tax-invoice-label { font-size: 15px; font-weight: 800; letter-spacing: 0.03em; text-align: right; }
  .tax-invoice-sub { font-size: 11px; color: #94a3b8; text-align: right; }
  .paid-stamp { display: inline-block; margin-top: 6px; border: 1.5px solid #16a34a; color: #16a34a; border-radius: 6px; padding: 2px 10px; font-weight: 800; font-size: 11px; letter-spacing: .08em; }
  .void-stamp { border-color: #dc2626; color: #dc2626; }
  .seller-name { font-size: 14px; font-weight: 700; margin-bottom: 3px; }
  .seller-details { font-size: 12px; color: #64748b; line-height: 1.6; margin-bottom: 18px; }
  .meta-row { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px; padding-bottom: 16px; border-bottom: 1px solid #eef2f6; }
  .meta-col { flex: 1; }
  .bill-to-label { font-size: 11.5px; font-weight: 700; margin-bottom: 6px; }
  .bill-to-name { font-size: 13px; font-weight: 600; }
  .bill-to-line { font-size: 11.5px; color: #64748b; margin-top: 3px; line-height: 1.5; }
  .kv-row { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 4px; font-size: 12px; }
  .kv-label { color: #64748b; font-weight: 600; }
  .kv-value { color: #0f172a; font-weight: 700; text-align: right; }
  table.items { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
  table.items th { text-align: left; padding: 6px 4px; color: #64748b; font-weight: 700; font-size: 11px; border-bottom: 1.5px solid #e2e8f0; }
  table.items th.right, table.items td.right { text-align: right; }
  table.items td { padding: 7px 4px; border-bottom: 1px solid #f1f5f9; }
  .item-desc { font-weight: 600; }
  .item-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .totals { margin-left: auto; width: 60%; font-size: 12.5px; margin-bottom: 16px; }
  .totals-row { display: flex; justify-content: space-between; padding: 5px 0; color: #374151; }
  .totals-final { display: flex; justify-content: space-between; padding: 10px 0 0; margin-top: 4px; border-top: 1.5px solid #e2e8f0; font-weight: 800; font-size: 14px; }
  .words-label { font-size: 11.5px; font-weight: 700; margin-bottom: 3px; }
  .words-value { font-size: 12.5px; color: #374151; margin-bottom: 20px; }
  .bank-box { background: #f8fafc; border: 1px solid #eef2f6; border-radius: 10px; padding: 12px 16px; font-size: 11.5px; line-height: 1.7; }
  .bank-title { font-weight: 700; margin-bottom: 4px; }
  .bank-body { color: #64748b; }
</style>
</head>
<body>
  <div class="doc">
    <div class="top-row">
      <div>
        <div class="tax-invoice-label">${withGst ? "TAX INVOICE" : "INVOICE"}</div>
        <div class="tax-invoice-sub">Original for Recipient</div>
        <div class="paid-stamp ${invoice.status === "void" ? "void-stamp" : ""}">${invoice.status === "void" ? "VOID" : "PAID"}</div>
      </div>
    </div>

    <div class="seller-name">${esc(seller.name)}</div>
    <div class="seller-details">
      ${esc(seller.address)}<br/>
      Contact: ${esc(seller.contact)}<br/>
      Email: ${esc(seller.email)}<br/>
      ${withGst ? `GST No.: ${esc(seller.gst_number)}<br/>` : ""}
      PAN: ${esc(seller.pan)}
    </div>

    <div class="meta-row">
      <div class="meta-col">
        <div class="bill-to-label">Bill To</div>
        <div class="bill-to-name">${esc(customer.salon_name)}</div>
        ${customer.address ? `<div class="bill-to-line">${esc(customer.address)}</div>` : ""}
        ${customer.contact ? `<div class="bill-to-line">Contact: ${esc(customer.contact)}</div>` : ""}
        ${customer.email ? `<div class="bill-to-line">Email: ${esc(customer.email)}</div>` : ""}
      </div>
      <div class="meta-col">
        <div class="kv-row"><span class="kv-label">Invoice No.</span><span class="kv-value">${esc(invoice.invoice_no)}</span></div>
        <div class="kv-row"><span class="kv-label">Invoice Date</span><span class="kv-value">${dLong(invoice.issued_at)}</span></div>
        <div class="kv-row"><span class="kv-label">Plan</span><span class="kv-value">${esc(invoice.plan_label)}</span></div>
        <div class="kv-row"><span class="kv-label">Payment Mode</span><span class="kv-value">${esc(invoice.payment_mode || "-")}</span></div>
        ${invoice.transaction_id ? `<div class="kv-row"><span class="kv-label">Transaction ID</span><span class="kv-value">${esc(invoice.transaction_id)}</span></div>` : ""}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr><th>#</th><th>Description</th><th class="right">Amount (Rs.)</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            <div class="item-desc">SalonOx Software Subscription${invoice.plan_name ? ` - ${esc(invoice.plan_name)}` : ""}</div>
            <div class="item-sub">${esc(invoice.plan_label)}${period ? ` (${esc(period)})` : ""}</div>
            ${invoice.description ? `<div class="item-sub">${esc(invoice.description)}</div>` : ""}
          </td>
          <td class="right">${invoice.subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      ${invoice.credit && invoice.credit > 0 ? `<div class="totals-row"><span>Credit for unused previous plan (already deducted)</span><span>- ${money(invoice.credit)}</span></div>` : ""}
      <div class="totals-row"><span>Subtotal</span><span>${money(invoice.subtotal)}</span></div>
      ${withGst ? `<div class="totals-row"><span>CGST (${half}%)</span><span>${money(cgst)}</span></div>
      <div class="totals-row"><span>SGST (${half}%)</span><span>${money(sgst)}</span></div>` : `<div class="totals-row"><span>GST</span><span>Not applicable</span></div>`}
      <div class="totals-final"><span>${withGst ? "Total Invoice Value (Incl. GST)" : "Total Invoice Value"}</span><span>${money(invoice.total)}</span></div>
    </div>

    <div class="words-label">Amount in Words</div>
    <div class="words-value">${esc(amount_in_words)}</div>

    <div class="bank-box">
      <div class="bank-title">Bank Details (for NEFT/RTGS)</div>
      <div class="bank-body">
        Bank: ${esc(seller.bank_name)}<br/>
        Branch: ${esc(seller.bank_branch)}<br/>
        A/C No.: ${esc(seller.bank_account_number)}<br/>
        IFSC Code: ${esc(seller.bank_ifsc)}<br/>
        A/C Type: ${esc(seller.bank_account_type)}
      </div>
    </div>
  </div>
</body>
</html>`;
}
