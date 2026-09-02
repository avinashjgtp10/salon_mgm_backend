import { buildReceiptHtml } from "./receipt-html.template";

// Renders the same invoice layout as the dashboard's ViewBillModal print,
// returned as raw bytes — callers upload them straight to Meta (WhatsApp
// documents) or hand them to an authenticated download endpoint, never
// needing a publicly-hosted URL.
export async function renderReceiptPdf(params: Parameters<typeof buildReceiptHtml>[0]): Promise<Buffer> {
    // Puppeteer 25.x ships as an ESM package — a static import produces a `require()`
    // call in this CommonJS project and fails at runtime, so this loads it dynamically.
    const puppeteer = (await import("puppeteer")).default;
    const html = buildReceiptHtml(params);
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

