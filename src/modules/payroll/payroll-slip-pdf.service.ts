import { buildPayrollSlipHtml } from "./payroll-slip.template";
import { renderHtmlToPdf } from "../../config/puppeteer";

// Uses the shared Chromium instance (config/puppeteer.ts) instead of
// launching a fresh browser process per call — see sales/receipt-pdf.service.ts's
// comment for why. Kept as a separate sibling function from
// renderPayrollReceiptPdf rather than a shared generic renderer since the
// Slip and Receipt are two distinct documents with unrelated param shapes.
export async function renderPayrollSlipPdf(params: Parameters<typeof buildPayrollSlipHtml>[0]): Promise<Buffer> {
    const html = buildPayrollSlipHtml(params);
    return renderHtmlToPdf(html, { format: "A4", printBackground: true });
}
