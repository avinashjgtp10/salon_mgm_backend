import { buildSalonPlanInvoiceHtml, SalonPlanInvoicePrintPayload } from "./salon-plan-invoice-html.template";
import { renderHtmlToPdf } from "../../config/puppeteer";

// Uses the shared Chromium instance (config/puppeteer.ts) instead of
// launching a fresh browser process per call — see receipt-pdf.service.ts's
// comment for why.
export async function renderSalonPlanInvoicePdf(payload: SalonPlanInvoicePrintPayload): Promise<Buffer> {
    const html = buildSalonPlanInvoiceHtml(payload);
    return renderHtmlToPdf(html, { format: "A4", printBackground: true });
}
