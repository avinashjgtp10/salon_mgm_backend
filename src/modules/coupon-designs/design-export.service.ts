import fs from "fs";
import path from "path";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { getSharedBrowser, shutdownSharedBrowser } from "../../config/puppeteer";
import {
  buildDocument, renderDesign, renderSheet, type SheetOptions,
} from "./render/design-render";

/**
 * Server-side export for coupon designs.
 *
 * Modelled on sales/receipt-pdf.service.ts, but deliberately does NOT inherit
 * its old habit of never deleting anything — here old exports are swept,
 * because a 300-DPI A4 PNG is several MB and fills a disk quickly. The
 * shared-browser idea this file pioneered (one lazily-created Chromium
 * reused forever, since it costs 150–300MB RSS and a small instance OOMs on
 * concurrent launches) has since moved to config/puppeteer.ts so every PDF
 * service in the app shares the SAME single browser process, not just this one.
 */

type ExportFormat = "png" | "jpeg" | "pdf";

export interface ExportOptions {
  format: ExportFormat;
  /** 72 (screen), 150 (good print), 300 (press). */
  dpi?: 72 | 150 | 300;
  values?: Record<string, string>;
  title?: string;
  /** Present = render an A4 sheet of copies instead of a single artboard. */
  sheet?: SheetOptions | null;
}

export interface ExportResult {
  filePath: string;
  fileName: string;
  bytes: number;
  /** Tokens that had no value — surfaced so the UI can warn rather than
   *  silently ship a coupon with a blank where the code should be. */
  missingTokens: string[];
}

// __dirname-relative traversal breaks once esbuild bundles this file into a
// single dist/index.js — see the matching comment in upload.middleware.ts.
const OUT_DIR = path.join(process.cwd(), "uploads/designs");
const RETENTION_MS = 24 * 60 * 60 * 1000;
// Chrome is 150–300MB resident per browser. Two pages in flight is what a
// small instance tolerates; the rest queue.
const MAX_CONCURRENT = 2;
// A 300-DPI A2 is ~139MB of raw bitmap before Chrome's own copies. Refuse
// rather than OOM the box.
const MAX_PIXELS = 40_000_000;

let active = 0;
const waiters: (() => void)[] = [];

// getBrowser() used to live here (lazy singleton launch) — now shared across
// the whole app via config/puppeteer.ts's getSharedBrowser(). This file's own
// acquire()/release() concurrency gate (max 2 pages in flight) stays local,
// since it's specific to this feature's high-DPI image-export memory profile.
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) { active++; return; }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

/** Deletes exports older than the retention window. Best-effort. */
function sweepOldExports(): void {
  try {
    if (!fs.existsSync(OUT_DIR)) return;
    const now = Date.now();
    for (const f of fs.readdirSync(OUT_DIR)) {
      const p = path.join(OUT_DIR, f);
      try {
        if (now - fs.statSync(p).mtimeMs > RETENTION_MS) fs.unlinkSync(p);
      } catch { /* another process may have removed it */ }
    }
  } catch (err) {
    logger.warn("designExport: sweep failed", { err });
  }
}

export const designExportService = {
  async export(doc: Record<string, unknown>, opts: ExportOptions): Promise<ExportResult> {
    const dpi = opts.dpi ?? 72;
    const values = opts.values ?? {};
    const canvas = (doc.canvas ?? {}) as Record<string, unknown>;
    const width = Number(canvas.width) || 384;
    const height = Number(canvas.height) || 240;

    const rendered = opts.sheet
      ? renderSheet(doc, values, opts.sheet)
      : renderDesign(doc, values);

    const html = buildDocument(rendered.html, {
      title: opts.title,
      sheet: opts.sheet ?? null,
      widthPx: width,
      heightPx: height,
      fonts: doc.fonts as string[] | undefined,
    });

    // A4 at 96dpi when in sheet mode; otherwise the artboard's own size.
    const vpW = opts.sheet ? 794 : width;
    const vpH = opts.sheet ? 1123 : height;
    const scale = dpi / 72;

    if (vpW * scale * vpH * scale > MAX_PIXELS) {
      throw new AppError(
        400,
        `That size at ${dpi} DPI is too large to render. Try a lower DPI.`,
        "EXPORT_TOO_LARGE",
      );
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    sweepOldExports();

    await acquire();
    let page;
    try {
      const browser = await getSharedBrowser();
      page = await browser.newPage();
      await page.setViewport({ width: Math.ceil(vpW), height: Math.ceil(vpH), deviceScaleFactor: scale });
      await page.setContent(html, { waitUntil: "load" });
      // Fonts must be ready before capture or Chrome renders a fallback face
      // and the export silently differs from the editor. Passed as a string so
      // this file needs no DOM lib.
      await page.evaluateHandle("document.fonts.ready");

      const fileName = `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${opts.format}`;
      const filePath = path.join(OUT_DIR, fileName);

      if (opts.format === "pdf") {
        // PDF keeps text as real vector glyphs with embedded fonts — the whole
        // reason this pipeline renders HTML rather than a canvas bitmap.
        const pdf = opts.sheet
          ? await page.pdf({ format: "A4", printBackground: true })
          : await page.pdf({ width: `${width}px`, height: `${height}px`, printBackground: true, pageRanges: "1" });
        fs.writeFileSync(filePath, Buffer.from(pdf));
      } else {
        const shot = await page.screenshot({
          type: opts.format,
          ...(opts.format === "jpeg" ? { quality: 92 } : {}),
          fullPage: false,
        });
        fs.writeFileSync(filePath, Buffer.from(shot));
      }

      const bytes = fs.statSync(filePath).size;
      logger.info("designExport: rendered", { fileName, format: opts.format, dpi, bytes });
      return { filePath, fileName, bytes, missingTokens: rendered.missing };
    } finally {
      // Always close the PAGE; the browser is shared and stays up.
      if (page) await page.close().catch(() => undefined);
      release();
    }
  },

  /** For tests and graceful shutdown. Delegates to the app-wide shared
   *  browser (config/puppeteer.ts) — kept here too since other code may
   *  already call designExportService.shutdown(). */
  shutdown: shutdownSharedBrowser,
};
