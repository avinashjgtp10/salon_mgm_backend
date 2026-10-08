import logger from "./logger";

// Shared headless-Chromium browser for every PDF/image render in this app
// (receipts, payroll slips, salon-plan invoices, coupon exports, WhatsApp
// template sample PDFs). Extracted from coupon-designs/design-export.service.ts,
// which already solved this problem — every OTHER PDF service in this repo used
// to launch (and close) a brand-new Chromium PROCESS per call. On a small/
// resource-constrained instance, a handful of concurrent renders (a receipt
// printing at checkout + a payroll slip + a WhatsApp template submission all
// landing at once) could exhaust available memory/OS process slots outright —
// confirmed in production as `Failed to launch the browser process ... Cannot
// fork ... Resource temporarily unavailable (11)` on both a Submit-to-Meta
// template-review PDF and a WhatsApp Test Message send for bill_receipt, both
// of which render a PDF via receipt-pdf.service.ts.
//
// One browser process is launched lazily on first use and reused forever;
// callers only ever open/close a PAGE (a tab), which is vastly cheaper than a
// whole new browser process. If Chrome itself dies (OOM, crash), the cached
// promise is dropped so the next call launches a fresh instance instead of
// reusing a dead handle forever.

/**
 * Structural types instead of `import type { Browser, Page } from "puppeteer"`.
 *
 * Puppeteer 25 is ESM-only, and a type-import of it from this CommonJS build
 * needs a resolution-mode attribute the current tsconfig doesn't support — a
 * bare dynamic import sidesteps that, so this just describes the surface area
 * every caller actually uses.
 */
export interface HeadlessPage {
  setViewport(v: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  setContent(html: string, o?: { waitUntil?: string }): Promise<unknown>;
  evaluateHandle(fn: string): Promise<unknown>;
  pdf(o: Record<string, unknown>): Promise<Buffer | Uint8Array>;
  screenshot(o: Record<string, unknown>): Promise<Buffer | Uint8Array>;
  close(): Promise<void>;
}
export interface HeadlessBrowser {
  newPage(): Promise<HeadlessPage>;
  close(): Promise<void>;
  on(event: string, cb: () => void): void;
}

let browserPromise: Promise<HeadlessBrowser> | null = null;

export async function getSharedBrowser(): Promise<HeadlessBrowser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = (await import("puppeteer")).default;
      const b = (await puppeteer.launch({
        headless: true,
        // --disable-dev-shm-usage avoids a very common container failure mode
        // where Chrome exhausts the small /dev/shm partition before it
        // exhausts real RAM.
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        // Set in the Dockerfile so we use the apt-installed Chromium rather
        // than a second downloaded copy.
        ...(process.env.PUPPETEER_EXECUTABLE_PATH
          ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
          : {}),
      })) as unknown as HeadlessBrowser;
      b.on("disconnected", () => {
        logger.warn("⚠️  Shared Puppeteer browser disconnected — will relaunch on next use");
        browserPromise = null;
      });
      return b;
    })().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/** For tests and graceful shutdown. */
export async function shutdownSharedBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (b) await b.close().catch(() => undefined);
}

/**
 * Renders one page's worth of HTML into a PDF buffer using the shared
 * browser — opens and closes its OWN page (never the browser itself), so
 * concurrent callers don't stomp on each other's content.
 */
export async function renderHtmlToPdf(
  html: string,
  pdfOptions: Record<string, unknown> = { format: "A4", printBackground: true }
): Promise<Buffer> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf(pdfOptions);
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
