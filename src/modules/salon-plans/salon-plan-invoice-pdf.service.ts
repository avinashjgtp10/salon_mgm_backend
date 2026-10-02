import { buildSalonPlanInvoiceHtml, SalonPlanInvoicePrintPayload } from "./salon-plan-invoice-html.template";

// Same Puppeteer pattern as sales/receipt-pdf.service.ts — dynamic import
// because Puppeteer 25.x ships ESM-only and a static import breaks in this
// CommonJS project.
export async function renderSalonPlanInvoicePdf(payload: SalonPlanInvoicePrintPayload): Promise<Buffer> {
    const puppeteer = (await import("puppeteer")).default;
    const html = buildSalonPlanInvoiceHtml(payload);
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        const pdf = await page.pdf({ format: "A4", printBackground: true });
        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}
