import { PayrollPayment } from "./payroll.types";

// Payment Receipt — confirms the salary was actually paid (payment date,
// method, amount, reference), distinct from the Salary Slip's calculation
// breakdown. Only ever generated for a period that already has a
// payroll_payments row, so this never shows partial/unpaid state.
export function buildPayrollReceiptHtml(params: {
    salon: { business_name: string; logo_url: string | null; email: string | null; phone: string | null; address: string | null };
    staffName: string;
    staffDesignation: string | null;
    periodLabel: string;
    documentId: string;
    payment: PayrollPayment;
    netSalary: number;
}): string {
    const { salon, staffName, staffDesignation, periodLabel, documentId, payment, netSalary } = params;
    const fmt = (n: number) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const salonName = salon.business_name || "Salon";
    const paymentDate = new Date(payment.paid_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "long", day: "numeric" });
    const generatedOn = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "long", day: "numeric" });
    const paymentMethodLabel = payment.payment_method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    const row = (label: string, value: string) => `
      <tr>
        <td style="padding:9px 14px;font-size:13px;font-weight:500;color:#111827;border:1px solid #e5e7eb">${label}</td>
        <td style="padding:9px 14px;text-align:right;font-size:13px;font-weight:600;color:#111827;border:1px solid #e5e7eb">${value}</td>
      </tr>`;

    const rows = [
        row("Payment Date", paymentDate),
        row("Payment Method", paymentMethodLabel),
        payment.payment_reference ? row("Transaction / Reference No.", payment.payment_reference) : "",
        row("Amount Paid", fmt(payment.amount)),
    ].filter(Boolean).join("");

    const logoBlock = salon.logo_url
        ? `<img class="doc-logo" src="${salon.logo_url}" alt="${salonName}">`
        : `<div class="doc-logo-placeholder">${salonName.charAt(0).toUpperCase()}</div>`;

    const contactLine = [salon.address, salon.phone, salon.email].filter(Boolean).join(" &middot; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Payment Receipt — ${staffName}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#111827;background:#fff}
  .page{width:210mm;padding:32px}
  .header{display:flex;align-items:center;gap:14px;border-bottom:2px solid #111827;padding-bottom:16px;margin-bottom:20px}
  .doc-logo{width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid #e5e7eb;flex-shrink:0}
  .doc-logo-placeholder{width:56px;height:56px;border-radius:8px;background:#f3f4f6;border:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#374151;flex-shrink:0}
  .salon-name{font-size:19px;font-weight:800}
  .salon-contact{font-size:11px;color:#6b7280;margin-top:3px}
  .doc-title{font-size:16px;font-weight:700;margin-top:20px}
  .paid-badge{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:12px;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;letter-spacing:.03em}
  .doc-meta{display:flex;justify-content:space-between;font-size:11.5px;color:#4b5563;margin-top:14px;margin-bottom:14px}
  .doc-meta div div:first-child{color:#9ca3af;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  .net-line{display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding:14px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px}
  .net-line-label{font-size:13px;font-weight:600;color:#166534}
  .net-line-val{font-size:20px;font-weight:800;color:#166534}
  .footer{margin-top:24px;font-size:11px;color:#6b7280;text-align:center}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    ${logoBlock}
    <div>
      <div class="salon-name">${salonName}</div>
      ${contactLine ? `<div class="salon-contact">${contactLine}</div>` : ""}
    </div>
  </div>

  <div class="doc-title">Payment Receipt</div>
  <div class="paid-badge">PAID</div>

  <div class="doc-meta">
    <div>
      <div>Staff</div>
      <div style="font-weight:600">${staffName}${staffDesignation ? ` &middot; ${staffDesignation}` : ""}</div>
    </div>
    <div>
      <div>Pay Period</div>
      <div style="font-weight:600">${periodLabel}</div>
    </div>
    <div>
      <div>Document ID</div>
      <div style="font-weight:600">${documentId}</div>
    </div>
    <div>
      <div>Generated</div>
      <div style="font-weight:600">${generatedOn}</div>
    </div>
  </div>

  <table>${rows}</table>

  <div class="net-line">
    <span class="net-line-label">Net Salary Paid</span>
    <span class="net-line-val">${fmt(netSalary)}</span>
  </div>

  <div class="footer">This is a computer-generated payment receipt confirming salary disbursement. No signature required.</div>
</div>
</body>
</html>`;
}
