import { buildReceiptHtml } from "./receipt-html.template";
import { renderHtmlToPdf } from "../../config/puppeteer";

// Renders the same invoice layout as the dashboard's ViewBillModal print,
// returned as raw bytes — callers upload them straight to Meta (WhatsApp
// documents) or hand them to an authenticated download endpoint, never
// needing a publicly-hosted URL.
//
// Uses the shared Chromium instance (config/puppeteer.ts) rather than
// launching a fresh browser process per call — this used to launch+close a
// whole new Chromium process every single render, which on a resource-
// constrained server could exhaust available memory/process slots outright
// under concurrent load (confirmed root cause of a real "Cannot fork /
// Resource temporarily unavailable" production failure on both a Submit-to-
// Meta template review and a WhatsApp Test Message send, both of which
// render a sample receipt PDF for bill_receipt).
export async function renderReceiptPdf(params: Parameters<typeof buildReceiptHtml>[0]): Promise<Buffer> {
    const html = buildReceiptHtml(params);
    return renderHtmlToPdf(html, { format: "A4", printBackground: true });
}

