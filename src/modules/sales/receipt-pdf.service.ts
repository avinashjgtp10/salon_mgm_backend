import { buildReceiptHtml } from "./receipt-html.template";
import { renderHtmlToPdf } from "../../config/puppeteer";

// Renders the bill as the narrow (80mm) receipt, returned as raw bytes — callers upload them straight to Meta
// (WhatsApp documents) or hand them to an authenticated download endpoint, never needing a publicly-hosted URL.
// Same look as the browser's web print receipt (frontend features/bookings/utils/printTemplates.ts).
//
// The page height is set by a script inside the HTML (it measures the rendered receipt and rewrites @page), so the
// PDF is exactly as long as the receipt: preferCSSPageSize makes Chromium honour that size instead of A4.
//
// Uses the shared Chromium instance (config/puppeteer.ts) rather than launching a fresh browser process per call —
// this used to launch+close a whole new Chromium process every single render, which on a resource-constrained
// server could exhaust available memory/process slots outright under concurrent load (confirmed root cause of a
// real "Cannot fork / Resource temporarily unavailable" production failure on both a Submit-to-Meta template
// review and a WhatsApp Test Message send, both of which render a sample receipt PDF for bill_receipt).
export async function renderReceiptPdf(params: Parameters<typeof buildReceiptHtml>[0]): Promise<Buffer> {
    const html = buildReceiptHtml(params);
    if (params.layout === "a4") {
        return renderHtmlToPdf(html, { format: "A4", printBackground: true });
    }
    return renderHtmlToPdf(html, { printBackground: true, preferCSSPageSize: true });
}
