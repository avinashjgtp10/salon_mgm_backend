import { SALONOX_LOGO_DATA_URI } from "./payroll-brand";
import { DEFAULT_SALON_TIMEZONE } from "../../config/salonTimezone";
import { formatMoney, dateLocale } from "../../config/currency";
import { PayrollPayment, StaffPayrollSummary } from "./payroll.types";

// Salon / staff names and addresses are free text typed by users and this HTML is rendered by Chromium,
// so everything interpolated below goes through esc().
const esc = (v: string | number | null | undefined): string =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Salary Payment Receipt — confirms the salary was actually paid. Only ever generated for a period that
// already has a payroll_payments row, so this never shows partial/unpaid state.
export function buildPayrollReceiptHtml(params: {
    salon: { business_name: string; logo_url: string | null; email: string | null; phone: string | null; address: string | null; timezone?: string | null; currency?: string | null };
    branchName: string | null;
    staffName: string;
    staffDesignation: string | null;
    employeeCode: string | null;
    joinedDate: string | null;
    periodStart: string;
    periodEnd: string;
    documentId: string;
    summary: StaffPayrollSummary;
    payment: PayrollPayment;
    amountInWords: string | null;
}): string {
    const { salon, branchName, staffName, staffDesignation, employeeCode, joinedDate, periodStart, periodEnd, documentId, summary, payment, amountInWords } = params;
    const fmt = (n: number) => formatMoney(n, salon.currency);
    const salonName = salon.business_name || "Salon";
    const tz = salon.timezone || DEFAULT_SALON_TIMEZONE;
    const locale = dateLocale(salon.currency);

    // A bare YYYY-MM-DD is a calendar day, not an instant — format it in UTC so it never shifts by timezone.
    const day = (iso: string) => {
        const bare = iso.length <= 10;
        const d = new Date(bare ? `${iso}T12:00:00Z` : iso);
        return d.toLocaleDateString(locale, { timeZone: bare ? "UTC" : tz, day: "2-digit", month: "short", year: "numeric" });
    };
    const paidAt = new Date(payment.paid_at);
    const paymentDateTime = `${day(payment.paid_at)}, ${paidAt.toLocaleTimeString(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" }).toUpperCase()}`;
    const period = `${day(periodStart)} – ${day(periodEnd)}`;
    // "bank_transfer" -> "Bank Transfer", and the UPI acronym stays upper-case.
    const methodLabel = payment.payment_method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bUpi\b/g, "UPI");

    const isHourly = summary.compensation_type === "hourly";
    const basisBasic = isHourly
        ? `${Number(summary.hours_worked ?? 0).toFixed(2)} hrs × ${fmt(Number(summary.hourly_rate ?? 0))}`
        : "Fixed";

    const earnings = [
        { label: "Basic Salary", basis: basisBasic, amount: summary.base_salary },
        { label: "Commission", basis: "—", amount: summary.commission_total },
        { label: "Tips", basis: "—", amount: summary.tips_total },
        { label: "Bonus", basis: "—", amount: summary.bonus },
        { label: "Other Earnings", basis: "—", amount: summary.other_earning },
    ];
    const deductions = [
        { label: "Salary Advance", basis: "—", amount: summary.salary_advance },
        { label: "Other Deductions", basis: "—", amount: summary.deductions },
    ];
    const totalEarnings = earnings.reduce((s, r) => s + r.amount, 0);
    const totalDeductions = deductions.reduce((s, r) => s + r.amount, 0);
    const rowsHtml = (rows: { label: string; basis: string; amount: number }[]) =>
        rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.basis)}</td><td class="amt">${fmt(r.amount)}</td></tr>`).join("");

    // The header carries the SalonOx brand (the real logo file); the salon's own details sit on the right.
    const logoBlock = `<img class="logo" src="${SALONOX_LOGO_DATA_URI}" alt="SalonOx"><div class="wm-tag">Simplifying Salon Business</div>`;

    const ic = (path: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10294d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const pinIcon = ic(`<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>`);
    const phoneIcon = ic(`<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>`);
    const mailIcon = ic(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>`);
    const calIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10294d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
    const docIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10294d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/></svg>`;
    const checkIcon = `<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#16a34a"/><path d="M7 12.5l3.3 3.3L17 9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const detail = (k: string, v: string) => `<div class="row"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Salary Payment Receipt — ${esc(staffName)}</title>
<style>
  @page{size:A4;margin:0}
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--navy:#0f2747;--ink:#1c2b45;--mut:#6a7a93;--line:#e2e8f0;--panel:#f7f9fc;--green:#16a34a;--greenbg:#e7f8ee;--greenline:#a7e3bf}
  body{font-family:'Segoe UI','Inter',Helvetica,Arial,sans-serif;font-size:13px;color:var(--ink);background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;height:296mm;padding:22px 38px 0;overflow:hidden;position:relative}

  .top{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:1px solid var(--line)}
  .logo{display:block;height:50px;width:auto}
  .wm-tag{font-size:11.5px;color:#34506f;margin:2px 0 0 52px}
  .contact{font-size:11px;color:#34506f;display:grid;gap:5px;max-width:340px}
  .contact div{display:flex;gap:8px;align-items:flex-start;line-height:1.35}
  .contact svg{flex-shrink:0;margin-top:1px}

  .title{display:flex;justify-content:space-between;align-items:flex-start;margin-top:24px}
  .title h1{font-size:29px;font-weight:800;color:var(--navy);letter-spacing:-.015em}
  .title .sub{font-size:15px;color:var(--mut);margin-top:4px}
  .paid{display:inline-flex;align-items:center;gap:8px;background:var(--greenbg);border:1px solid var(--greenline);color:#15803d;font-weight:800;font-size:17px;padding:5px 20px;border-radius:999px}
  .refs{text-align:right;margin-top:8px}
  .refs div{display:grid;grid-template-columns:auto 190px;gap:16px;justify-content:end;font-size:13px;padding:2px 0}
  .refs span{color:var(--mut);text-align:left}.refs b{font-weight:500;color:var(--ink);text-align:right}

  .cards{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}
  .card{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:12px 18px}
  .card.green{background:#f1faf5;border-color:#d7efe0}
  .card h3{font-size:16px;font-weight:700;color:var(--navy);margin-bottom:6px}
  .row{display:grid;grid-template-columns:118px 1fr;padding:7px 0;font-size:13.5px;align-items:center}
  .row .k{color:var(--mut)}.row .v{color:var(--ink)}
  .card.green .row{grid-template-columns:1fr auto}
  .card.green .row .v{text-align:right}
  .paidbox{display:flex;justify-content:space-between;align-items:center;background:#dff5e8;border-radius:8px;padding:9px 14px;margin:4px 0}
  .paidbox span{color:#15803d;font-weight:700;font-size:14px}.paidbox b{font-size:23px;color:var(--navy);font-weight:800}
  .chip{display:inline-block;background:var(--greenbg);color:#15803d;border:1px solid var(--greenline);border-radius:999px;padding:1px 15px;font-weight:700;font-size:12.5px}

  .strip{display:grid;grid-template-columns:1fr 1fr;margin-top:16px;padding-bottom:16px;border-bottom:1px solid var(--line)}
  .strip>div{display:flex;align-items:center;gap:12px}
  .strip>div:last-child{border-left:1px solid var(--line);padding-left:24px}
  .sico{width:38px;height:38px;border:1px solid var(--line);border-radius:9px;display:flex;align-items:center;justify-content:center;background:#fff}
  .strip small{display:block;font-size:11px;color:var(--mut)}
  .strip b{font-size:14px;font-weight:500;color:var(--ink)}

  .tables{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:20px;align-items:start}
  .tables h4{font-size:16px;font-weight:700;color:var(--navy);margin-bottom:7px}
  table{width:100%;border-collapse:collapse;border:1px solid var(--line);border-radius:6px;font-size:12px;background:#fff}
  th{background:var(--panel);text-align:left;font-weight:600;padding:6px 12px;border-bottom:1px solid var(--line);color:var(--ink)}
  td{padding:0 12px;height:33px;border-bottom:1px solid var(--line);color:var(--ink);white-space:nowrap}
  th+th,td+td{border-left:1px solid var(--line)}
  .amt{text-align:right}
  tr.total td{background:var(--panel);font-weight:700;height:37px;border-bottom:0}

  .net{display:flex;justify-content:space-between;align-items:center;margin-top:22px;padding:18px 26px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
  .net b{font-size:18px;color:var(--navy);font-weight:700}
  .net small{display:block;font-size:11.5px;color:var(--mut);margin-top:4px}
  .net .amount{border-left:1px solid #cfd8e3;padding-left:36px;font-size:31px;font-weight:800;color:var(--navy);white-space:nowrap}

  .foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:22px;padding-top:14px;border-top:1px solid var(--line)}
  .sign{font-size:11px;color:#34506f;line-height:1.45}
  .sign .line{width:170px;border-top:1px solid #8a97ab;padding-top:5px;margin-top:32px}
  .note{text-align:right;font-size:10.5px;color:var(--mut);line-height:1.6;max-width:340px}
</style>
</head>
<body>
<div class="page">
  <div class="top">
    <div>${logoBlock}</div>
    <div class="contact">
      ${salon.address ? `<div>${pinIcon}<span>${esc(salon.address)}</span></div>` : ""}
      ${salon.phone ? `<div>${phoneIcon}<span>${esc(salon.phone)}</span></div>` : ""}
      ${salon.email ? `<div>${mailIcon}<span>${esc(salon.email)}</span></div>` : ""}
    </div>
  </div>

  <div class="title">
    <div>
      <h1>Salary Payment Receipt</h1>
      <div class="sub">Confirmation of Salary Disbursement</div>
    </div>
    <div>
      <div class="paid">${checkIcon} Paid</div>
      <div class="refs">
        <div><span>Receipt No.</span><b>${esc(documentId)}</b></div>
        <div><span>Payment Date</span><b>${esc(paymentDateTime)}</b></div>
      </div>
    </div>
  </div>

  <div class="cards">
    <div class="card">
      <h3>Staff Details</h3>
      ${detail("Name", staffName)}
      ${detail("Staff ID", employeeCode || "—")}
      ${detail("Designation", staffDesignation || "—")}
      ${detail("Branch", branchName || "—")}
      ${detail("Salary Type", isHourly ? "Hourly" : "Fixed Salary")}
      ${detail("Joining Date", joinedDate ? day(joinedDate) : "—")}
    </div>
    <div class="card green">
      <h3>Payment Summary</h3>
      <div class="row"><span class="k">Net Salary (Payable)</span><span class="v">${fmt(summary.net_salary)}</span></div>
      <div class="row"><span class="k">Previous Advance</span><span class="v">${fmt(summary.salary_advance)}</span></div>
      <div class="paidbox"><span>Amount Paid</span><b>${fmt(Number(payment.amount))}</b></div>
      <div class="row"><span class="k">Payment Method</span><span class="v">${esc(methodLabel)}</span></div>
      <div class="row"><span class="k">Transaction Ref. / UTR</span><span class="v">${esc(payment.payment_reference || "—")}</span></div>
      <div class="row"><span class="k">Payment Status</span><span class="v"><span class="chip">Paid</span></span></div>
    </div>
  </div>

  <div class="strip">
    <div><div class="sico">${calIcon}</div><div><small>Salary Period</small><b>${esc(period)}</b></div></div>
    <div><div class="sico">${docIcon}</div><div><small>Payment Receipt ID</small><b>${esc(documentId)}</b></div></div>
  </div>

  <div class="tables">
    <div>
      <h4>Earnings</h4>
      <table>
        <thead><tr><th>Particulars</th><th>Hours / Basis</th><th class="amt">Amount</th></tr></thead>
        <tbody>${rowsHtml(earnings)}<tr class="total"><td colspan="2">Total Earnings</td><td class="amt">${fmt(totalEarnings)}</td></tr></tbody>
      </table>
    </div>
    <div>
      <h4>Deductions</h4>
      <table>
        <thead><tr><th>Particulars</th><th>Basis</th><th class="amt">Amount</th></tr></thead>
        <tbody>${rowsHtml(deductions)}<tr class="total"><td colspan="2">Total Deductions</td><td class="amt">${fmt(totalDeductions)}</td></tr></tbody>
      </table>
    </div>
  </div>

  <div class="net">
    <div>
      <b>Net Salary Payable</b>
      ${amountInWords ? `<small>(In Words: ${esc(amountInWords)})</small>` : ""}
    </div>
    <div class="amount">${fmt(summary.net_salary)}</div>
  </div>

  <div class="foot">
    <div class="sign"><div class="line">Authorized Signature<br>(For ${esc(salonName)})</div></div>
    <div class="note">This is a computer-generated payment receipt<br>and does not require a physical signature.<br>Powered by SalonOx</div>
  </div>
</div>
</body>
</html>`;
}
