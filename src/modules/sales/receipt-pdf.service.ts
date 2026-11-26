import { buildReceiptHtml } from "./receipt-html.template";
import { renderHtmlToPdf } from "../../config/puppeteer";
import { getSalonLanguage } from "../../config/language";

// Renders the bill as the A4 invoice, returned as raw bytes — callers upload them straight to Meta
// (WhatsApp documents) or hand them to an authenticated download endpoint, never needing a publicly-hosted URL.
//
// layout "narrow" gives the 80mm thermal-style receipt instead. Its page height is set by a script inside the HTML (it
// measures the rendered receipt and rewrites @page), and preferCSSPageSize makes Chromium honour that size.
//
// Uses the shared Chromium instance (config/puppeteer.ts) rather than launching a fresh browser process per call —
// this used to launch+close a whole new Chromium process every single render, which on a resource-constrained
// server could exhaust available memory/process slots outright under concurrent load (confirmed root cause of a
// real "Cannot fork / Resource temporarily unavailable" production failure on both a Submit-to-Meta template
// review and a WhatsApp Test Message send, both of which render a sample receipt PDF for bill_receipt).
export async function renderReceiptPdf(params: Parameters<typeof buildReceiptHtml>[0]): Promise<Buffer> {
    // The receipt is written in the salon's language (salons.language) unless the caller already knows it.
    const language = params.salon.language ?? (await getSalonLanguage(params.sale?.salon_id));
    const html = buildReceiptHtml({ ...params, salon: { ...params.salon, language } });
    if (params.layout === "narrow") {
        return renderHtmlToPdf(html, { printBackground: true, preferCSSPageSize: true });
    }
    return renderHtmlToPdf(html, { format: "A4", printBackground: true });
}
