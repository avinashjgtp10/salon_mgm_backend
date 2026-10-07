import { buildPayrollReceiptHtml } from "./payroll-receipt.template";
import { renderHtmlToPdf } from "../../config/puppeteer";

// Sibling to sales/receipt-pdf.service.ts's renderReceiptPdf rather than a
// generalized shared function — payroll and sales receipts have unrelated
// param shapes (StaffPayrollSummary vs Sale/SaleItem), and this keeps the
// two features decoupled per the plan's stated default. Uses the shared
// Chromium instance (config/puppeteer.ts) instead of launching a fresh
// browser process per call — see sales/receipt-pdf.service.ts's comment for why.
export async function renderPayrollReceiptPdf(params: Parameters<typeof buildPayrollReceiptHtml>[0]): Promise<Buffer> {
    const html = buildPayrollReceiptHtml(params);
    return renderHtmlToPdf(html, { format: "A4", printBackground: true });
}
