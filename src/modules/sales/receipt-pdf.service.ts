import fs from "fs";
import path from "path";
import config from "../../config/env";
import { buildReceiptHtml } from "./receipt-html.template";
import { Sale, SaleItem } from "./sales.types";

async function renderReceiptPdf(params: Parameters<typeof buildReceiptHtml>[0]): Promise<Buffer> {
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

// process.cwd() (not __dirname) — the production build bundles everything into a
// single dist/index.js, which would change __dirname's depth relative to the
// project root and break a fixed "../../../" traversal. npm always runs both
// `ts-node-dev` and `node dist/server.js` from the backend root, so cwd is stable.
const RECEIPTS_DIR = path.join(process.cwd(), "uploads", "receipts");

// Generates the PDF (same invoice layout as the dashboard's ViewBillModal print)
// and saves it under uploads/receipts/, returning a URL built from PUBLIC_BASE_URL
// (the ngrok tunnel in dev) so WhatsApp's servers can actually fetch it —
// APP_BASE_URL is a LAN address and isn't reachable externally.
export async function generateAndSaveReceipt(params: {
    salon: {
        business_name: string;
        logo_url: string | null;
        email: string | null;
        phone: string | null;
        website_url: string | null;
        gst_number: string | null;
    };
    salonAddress: string | null;
    client: { name: string; phone: string | null; email: string | null };
    sale: Sale;
    items: SaleItem[];
    staffNames: Record<string, string>;
    appointment: {
        id: string;
        scheduledAt: string;
        durationMinutes: number;
        status: string;
        notes: string | null;
    } | null;
    paidAmount: number;
    dueAmount: number;
    couponCode: string | null;
}): Promise<string | null> {
    if (!config.publicBaseUrl) return null;

    const buffer = await renderReceiptPdf(params);
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

    const filename = `receipt-${params.sale.id}.pdf`;
    fs.writeFileSync(path.join(RECEIPTS_DIR, filename), buffer);

    return `${config.publicBaseUrl}/uploads/receipts/${filename}`;
}
