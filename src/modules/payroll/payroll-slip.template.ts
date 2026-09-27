import { StaffPayrollSummary } from "./payroll.types";

// Salary Slip — the calculation breakdown only (Basic/Commission/Tips/Bonus/
// Deductions -> Net Salary). Available for a period whether or not it has
// been paid yet, unlike the Payment Receipt below which only exists once a
// payroll_payments row does. Mirrors receipt-html.template.ts's branded-
// header shape (logo-or-initial, business name, address line) rather than
// the plainer text-only header the old combined template used.
export function buildPayrollSlipHtml(params: {
    salon: { business_name: string; logo_url: string | null; email: string | null; phone: string | null; address: string | null };
    staffName: string;
    staffDesignation: string | null;
    periodLabel: string;
    documentId: string;
    summary: StaffPayrollSummary;
}): string {
    const { salon, staffName, staffDesignation, periodLabel, documentId, summary } = params;
    const fmt = (n: number) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const salonName = salon.business_name || "Salon";
    const generatedOn = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "long", day: "numeric" });

    const row = (label: string, value: string, bold = false, color = "#111827") => `
      <tr>
        <td style="padding:9px 14px;font-size:13px;font-weight:${bold ? 700 : 500};color:${color};border:1px solid #e5e7eb">${label}</td>
        <td style="padding:9px 14px;text-align:right;font-size:13px;font-weight:${bold ? 700 : 500};color:${color};border:1px solid #e5e7eb">${value}</td>
      </tr>`;

    const rows = [
        row("Basic Salary", fmt(summary.base_salary)),
        summary.commission_by_category.services > 0 ? row("Service Commission", `+${fmt(summary.commission_by_category.services)}`, false, "#15803d") : "",
        summary.commission_by_category.products > 0 ? row("Product Commission", `+${fmt(summary.commission_by_category.products)}`, false, "#15803d") : "",
        summary.commission_by_category.memberships > 0 ? row("Membership Commission", `+${fmt(summary.commission_by_category.memberships)}`, false, "#15803d") : "",
        summary.commission_by_category.packages > 0 ? row("Package Commission", `+${fmt(summary.commission_by_category.packages)}`, false, "#15803d") : "",
        summary.commission_by_category.other > 0 ? row("Other Commission", `+${fmt(summary.commission_by_category.other)}`, false, "#15803d") : "",
        summary.tips_total > 0 ? row("Tips", `+${fmt(summary.tips_total)}`, false, "#15803d") : "",
        summary.bonus > 0 ? row("Bonus", `+${fmt(summary.bonus)}`, false, "#15803d") : "",
        summary.other_earning > 0 ? row("Other Earnings", `+${fmt(summary.other_earning)}`, false, "#15803d") : "",
        summary.salary_advance > 0 ? row("Salary Advance", `−${fmt(summary.salary_advance)}`, false, "#dc2626") : "",
        summary.deductions > 0 ? row("Deductions", `−${fmt(summary.deductions)}`, false, "#dc2626") : "",
        row("Net Salary", fmt(summary.net_salary), true),
    ].filter(Boolean).join("");

    const logoBlock = salon.logo_url
        ? `<img class="doc-logo" src="${salon.logo_url}" alt="${salonName}">`
        : `<div class="doc-logo-placeholder">${salonName.charAt(0).toUpperCase()}</div>`;

    const contactLine = [salon.address, salon.phone, salon.email].filter(Boolean).join(" &middot; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Salary Slip — ${staffName}</title>
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
  .doc-meta{display:flex;justify-content:space-between;font-size:11.5px;color:#4b5563;margin-top:6px;margin-bottom:14px}
  .doc-meta div div:first-child{color:#9ca3af;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  table{width:100%;border-collapse:collapse;margin-top:8px}
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

  <div class="doc-title">Salary Slip</div>
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
  <div class="footer">This is a computer-generated salary slip. No signature required.</div>
</div>
</body>
</html>`;
}
