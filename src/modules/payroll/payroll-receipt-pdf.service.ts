import { buildPayrollReceiptHtml } from "./payroll-receipt.template";

// Sibling to sales/receipt-pdf.service.ts's renderReceiptPdf rather than a
// generalized shared function — payroll and sales receipts have unrelated
// param shapes (StaffPayrollSummary vs Sale/SaleItem), and this keeps the
// two features decoupled per the plan's stated default. Same puppeteer
// pattern: dynamic import (puppeteer 25.x ships ESM-only).
export async function renderPayrollReceiptPdf(params: Parameters<typeof buildPayrollReceiptHtml>[0]): Promise<Buffer> {
    const puppeteer = (await import("puppeteer")).default;
    const html = buildPayrollReceiptHtml(params);
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
