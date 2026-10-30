// Server-side HTML for the subscription tax-invoice PDF (seller, Bill To, one subscription line, CGST/SGST split,
// amount in words).

export interface InvoicePrintPayload {
    invoice: {
        invoice_no: string;
        issued_at: string;
        plan_label: string;
        plan_name: string | null;
        payment_mode: string | null;
        transaction_id: string | null;
        status: string;
        /** ISO currency of the amounts; INR when left out (every older invoice). */
        currency?: string;
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
        name: string; address: string; gst_number: string; pan: string;
    };
    amount_in_words: string;
}

const moneyIn = (n: number, currency: string) => currency === "INR"
    ? `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dShort = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const dLong = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
const esc = (s: string | null | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildInvoiceHtml(p: InvoicePrintPayload): string {
    const { invoice, customer, seller, amount_in_words } = p;
    const currency = invoice.currency ?? "INR";
    const money = (n: number) => moneyIn(n, currency);
    // An invoice without GST (0%) is a plain invoice: no tax lines, and the seller's GST number isn't printed.
    const withGst = invoice.gst_percent > 0;
    const half = invoice.gst_percent / 2;
    const cgst = invoice.gst_amount / 2;
    const sgst = invoice.gst_amount - cgst;
    const period = invoice.period_start && invoice.period_end ? `${dShort(invoice.period_start)} - ${dShort(invoice.period_end)}` : "";

    // "Salonox Tech" -> the last word in the brand blue, like the logo.
    const nameWords = seller.name.trim().split(/\s+/);
    const nameTail = nameWords.length > 1 ? nameWords.pop()! : "";
    const nameHead = nameWords.join(" ");
    const ICON_PHONE = `<svg width="12" height="12" viewBox="0 0 16 16" fill="#64748b"><path d="M3.654 1.328a.678.678 0 0 0-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.6 17.6 0 0 0 4.168 6.608 17.6 17.6 0 0 0 6.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 0 0-.063-1.015l-2.307-1.794a.68.68 0 0 0-.58-.122l-2.19.547a1.75 1.75 0 0 1-1.657-.459L5.482 8.062a1.75 1.75 0 0 1-.46-1.657l.548-2.19a.68.68 0 0 0-.122-.58z"/></svg>`;
    const ICON_MAIL = `<svg width="12" height="12" viewBox="0 0 16 16" fill="#64748b"><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v.217l-8 4.8-8-4.8zm0 1.383v6.634l5.803-3.558zM6.761 8.83 0 12.9A2 2 0 0 0 2 14h12a2 2 0 0 0 2-1.1l-6.761-4.07L8 9.3zm3.436-.376L16 12.017V5.383z"/></svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: 'Segoe UI', Arial, sans-serif; color: #0f1b4d; font-size: 12px; }
  .doc { max-width: 760px; margin: 0 auto; border: 1px solid #e5e9f0; border-radius: 14px; padding: 28px; }
  .top-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid #e5e9f0; margin-bottom: 20px; }
  .seller-name { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; color: #0f1b4d; line-height: 1.1; margin-bottom: 8px; }
  .seller-name span { color: #2563eb; }
  .seller-details { font-size: 11.5px; color: #64748b; line-height: 1.65; max-width: 300px; }
  .tax-invoice-label { font-size: 21px; font-weight: 800; letter-spacing: 0.01em; text-align: right; color: #0f1b4d; }
  .tax-invoice-sub { font-size: 11px; color: #94a3b8; text-align: right; margin-top: 2px; }
  .paid-stamp { float: right; margin-top: 10px; background: #d1fae5; color: #047857; border-radius: 999px; padding: 4px 22px; font-weight: 800; font-size: 11px; letter-spacing: .08em; }
  .void-stamp { background: #fee2e2; color: #b91c1c; }
  .meta-row { display: flex; gap: 14px; margin-bottom: 22px; }
  .card { flex: 1; border: 1px solid #e5e9f0; border-radius: 10px; padding: 14px 16px; }
  .bill-to-label { font-size: 11.5px; font-weight: 700; margin-bottom: 8px; color: #0f1b4d; }
  .bill-to-name { font-size: 15px; font-weight: 800; color: #0f1b4d; }
  .bill-to-line { font-size: 11.5px; color: #64748b; margin-top: 4px; line-height: 1.5; }
  .bill-to-contact { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #475569; margin-top: 8px; }
  .kv-row { display: flex; justify-content: space-between; gap: 10px; padding: 7px 0; border-bottom: 1px solid #eef1f6; font-size: 12px; }
  .kv-row:last-child { border-bottom: none; }
  .kv-label { color: #64748b; }
  .kv-value { color: #0f1b4d; font-weight: 800; text-align: right; }
  table.items { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; margin-bottom: 18px; border: 1px solid #e5e9f0; border-radius: 8px; overflow: hidden; }
  table.items th { text-align: left; padding: 11px 12px; color: #0f1b4d; font-weight: 700; font-size: 11px; background: #e9f1fc; }
  table.items th.right, table.items td.right { text-align: right; }
  table.items td { padding: 12px; vertical-align: top; }
  table.items td + td { border-left: 1px solid #e5e9f0; }
  .item-desc { font-weight: 700; color: #0f1b4d; }
  .item-sub { font-size: 11px; color: #64748b; margin-top: 3px; }
  .item-sub + .item-sub { color: #94a3b8; }
  .totals { margin-left: auto; width: 58%; font-size: 12.5px; margin-bottom: 20px; }
  .totals-row { display: flex; justify-content: space-between; padding: 9px 12px; color: #334155; border-bottom: 1px solid #eef1f6; }
  .totals-final { display: flex; justify-content: space-between; padding: 12px 14px; margin-top: 10px; background: #dfeafb; border-radius: 6px; font-weight: 800; font-size: 13.5px; color: #0f1b4d; }
  .words-box { background: #f1f5f9; border-radius: 10px; padding: 14px 16px; }
  .words-label { font-size: 11.5px; font-weight: 700; margin-bottom: 4px; color: #0f1b4d; }
  .words-value { font-size: 13px; color: #334155; }
</style>
</head>
<body>
  <div class="doc">
    <div class="top-row">
      <div>
        <div class="seller-name">${esc(nameHead)}${nameTail ? ` <span>${esc(nameTail)}</span>` : ""}</div>
        <div class="seller-details">
          ${esc(seller.address)}<br/>
          ${withGst ? `GST No.: ${esc(seller.gst_number)}<br/>` : ""}
          PAN: ${esc(seller.pan)}
        </div>
      </div>
      <div>
        <div class="tax-invoice-label">${withGst ? "TAX INVOICE" : "INVOICE"}</div>
        <div class="tax-invoice-sub">Original for Recipient</div>
        <div class="paid-stamp ${invoice.status === "void" ? "void-stamp" : ""}">${invoice.status === "void" ? "VOID" : "PAID"}</div>
      </div>
    </div>

    <div class="meta-row">
      <div class="card">
        <div class="bill-to-label">Bill To</div>
        <div class="bill-to-name">${esc(customer.salon_name)}</div>
        ${customer.address ? `<div class="bill-to-line">${esc(customer.address)}</div>` : ""}
        ${customer.contact ? `<div class="bill-to-contact">${ICON_PHONE}<span>Contact: ${esc(customer.contact)}</span></div>` : ""}
        ${customer.email ? `<div class="bill-to-contact">${ICON_MAIL}<span>Email: ${esc(customer.email)}</span></div>` : ""}
      </div>
      <div class="card">
        <div class="kv-row"><span class="kv-label">Invoice No.</span><span class="kv-value">${esc(invoice.invoice_no)}</span></div>
        <div class="kv-row"><span class="kv-label">Invoice Date</span><span class="kv-value">${dLong(invoice.issued_at)}</span></div>
        <div class="kv-row"><span class="kv-label">Plan</span><span class="kv-value">${esc(invoice.plan_label)}</span></div>
        <div class="kv-row"><span class="kv-label">Payment Mode</span><span class="kv-value">${esc(invoice.payment_mode || "-")}</span></div>
        ${invoice.transaction_id ? `<div class="kv-row"><span class="kv-label">Transaction ID</span><span class="kv-value">${esc(invoice.transaction_id)}</span></div>` : ""}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr><th style="width:44px">#</th><th>Description</th><th class="right" style="width:150px">Amount (${currency === "INR" ? "Rs." : currency})</th></tr>
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

    ${amount_in_words ? `<div class="words-box"><div class="words-label">Amount in Words</div>
    <div class="words-value">${esc(amount_in_words)}</div></div>` : ""}
  </div>
</body>
</html>`;
}
