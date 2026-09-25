import { buildPayrollSlipHtml } from "./payroll-slip.template";

// Same puppeteer pattern as renderPayrollReceiptPdf — kept as a separate
// sibling function rather than a shared generic renderer since the Slip and
// Receipt are two distinct documents with unrelated param shapes.
export async function renderPayrollSlipPdf(params: Parameters<typeof buildPayrollSlipHtml>[0]): Promise<Buffer> {
    const puppeteer = (await import("puppeteer")).default;
    const html = buildPayrollSlipHtml(params);
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
