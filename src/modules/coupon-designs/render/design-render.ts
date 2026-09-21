/**
 * Design → HTML, server side.
 *
 * ⚠ MIRROR of the frontend's
 *   src/features/settings/designer/core/{schema,styles,renderHtml}.ts
 * The two repos deploy separately and there is no shared package yet, so this
 * is a hand-synced copy. The contract that keeps them honest:
 *
 *   1. SCHEMA_VERSION below must match the editor's.
 *   2. Every visual decision lives in elementToCss() on BOTH sides.
 *   3. The editor's Preview button renders this same HTML shape, so a human
 *      sees the export path before exporting.
 *
 * If you change how an element looks, change it here and there in one go.
 */

export const SCHEMA_VERSION = 1;

type Dict = Record<string, unknown>;

export interface RenderFill {
  kind: "solid" | "linear" | "radial" | "image";
  color?: string;
  stops?: { color: string; at: number }[];
  angle?: number;
  src?: string;
  repeat?: boolean;
}

const num = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

export const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function fillToCss(fill: RenderFill | undefined): string {
  if (!fill) return "transparent";
  switch (fill.kind) {
    case "solid": return fill.color ?? "transparent";
    case "linear": {
      const s = (fill.stops ?? []).map((x) => `${x.color} ${x.at}%`).join(", ");
      return s ? `linear-gradient(${fill.angle ?? 90}deg, ${s})` : "transparent";
    }
    case "radial": {
      const s = (fill.stops ?? []).map((x) => `${x.color} ${x.at}%`).join(", ");
      return s ? `radial-gradient(circle, ${s})` : "transparent";
    }
    case "image": return fill.src ? `url('${fill.src}')` : "transparent";
    default: return "transparent";
  }
}

/** Inline style string for one element. Mirrors the editor's elementToCss. */
export function elementToInline(el: Dict): string {
  const d: string[] = [
    "position:absolute",
    `left:${num(el.x)}px`,
    `top:${num(el.y)}px`,
    `width:${num(el.w)}px`,
    `height:${num(el.h)}px`,
    `opacity:${num(el.opacity, 1)}`,
  ];
  if (num(el.rotation)) d.push(`transform:rotate(${num(el.rotation)}deg)`);
  if (el.hidden) d.push("display:none");
  const sh = el.shadow as Dict | undefined;
  if (sh) d.push(`filter:drop-shadow(${num(sh.x)}px ${num(sh.y)}px ${num(sh.blur)}px ${str(sh.color, "#0006")})`);

  if (el.type === "text") {
    const align = str(el.align, "left");
    d.push(
      "display:flex", "flex-direction:column", "justify-content:center",
      `align-items:${align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start"}`,
      `text-align:${align}`,
      `font-family:${str(el.fontFamily, "Inter, sans-serif")}`,
      `font-size:${num(el.fontSize, 16)}px`,
      `font-weight:${num(el.fontWeight, 400)}`,
      `font-style:${el.italic ? "italic" : "normal"}`,
      `text-decoration:${el.underline ? "underline" : "none"}`,
      `letter-spacing:${num(el.letterSpacing)}px`,
      `line-height:${num(el.lineHeight, 1.2)}`,
      `color:${str(el.color, "#111827")}`,
      "overflow-wrap:break-word", "white-space:pre-wrap",
    );
    if (num(el.strokeWidth) > 0) {
      d.push(`-webkit-text-stroke-width:${num(el.strokeWidth)}px`,
             `-webkit-text-stroke-color:${str(el.strokeColor, "#000")}`);
    }
  } else if (el.type === "shape") {
    const fill = el.fill as RenderFill | undefined;
    d.push(`background:${fillToCss(fill)}`);
    if (fill?.kind === 'image') {
      d.push(fill.repeat ? 'background-repeat:repeat' : 'background-size:cover', 'background-position:center');
    }
    d.push(el.shape === "ellipse" ? "border-radius:50%" : `border-radius:${num(el.radius)}px`);
    if (num(el.strokeWidth) > 0) d.push(`border:${num(el.strokeWidth)}px solid ${str(el.stroke, "#111827")}`);
    d.push("box-sizing:border-box");
  } else if (el.type === "image") {
    const f = (el.filters ?? {}) as Dict;
    const src = str(el.src);
    d.push(
      `background-image:${src ? `url('${src}')` : "none"}`,
      `background-size:${el.fit === "fill" ? "100% 100%" : str(el.fit, "cover")}`,
      `background-position:${num(el.focalX, 0.5) * 100}% ${num(el.focalY, 0.5) * 100}%`,
      "background-repeat:no-repeat",
      `background-color:${src ? "transparent" : "#f2f4f7"}`,
      `border-radius:${num(el.radius)}px`,
    );
    const parts: string[] = [];
    if (num(f.brightness, 100) !== 100) parts.push(`brightness(${num(f.brightness, 100)}%)`);
    if (num(f.contrast, 100) !== 100) parts.push(`contrast(${num(f.contrast, 100)}%)`);
    if (num(f.saturate, 100) !== 100) parts.push(`saturate(${num(f.saturate, 100)}%)`);
    if (num(f.blur) > 0) parts.push(`blur(${num(f.blur)}px)`);
    if (parts.length) d.push(`filter:${parts.join(" ")}`);
  }

  return d.join(";");
}

export function resolveTokens(raw: string, values: Record<string, string>) {
  const missing: string[] = [];
  const text = raw.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = values[k];
    if (v === undefined || v === "") { missing.push(k); return ""; }
    return v;
  });
  return { text, missing };
}

/** Shrinks [data-autofit] text until it fits. Runs IN the page so the editor
 *  preview and the export agree by construction, not by two implementations. */
const AUTOFIT_SCRIPT = `<script>(function(){
  var n=document.querySelectorAll('[data-autofit]');
  for(var i=0;i<n.length;i++){var e=n[i],s=parseFloat(getComputedStyle(e).fontSize),g=0;
    while((e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)&&s>6&&g<200){s-=1;g++;e.style.fontSize=s+'px';}}
  document.documentElement.setAttribute('data-render-ready','1');
})();</script>`;

export interface RenderResult { html: string; missing: string[] }

/** One artboard, sized exactly to the design. */
export function renderDesign(doc: Dict, values: Record<string, string> = {}): RenderResult {
  const canvas = (doc.canvas ?? {}) as Dict;
  const width = num(canvas.width, 384), height = num(canvas.height, 240);
  const elements = Array.isArray(doc.elements) ? (doc.elements as Dict[]) : [];
  const missing: string[] = [];

  const body = elements.map((el) => {
    if (el.hidden) return "";
    const style = elementToInline(el);
    if (el.type === "text") {
      const r = resolveTokens(str(el.content), values);
      missing.push(...r.missing);
      const af = el.autoFit === "shrink" ? ' data-autofit="1"' : "";
      return `<div style="${style}"${af}><span>${esc(r.text)}</span></div>`;
    }
    return `<div style="${style}"></div>`;
  }).join("");

  const bg = fillToCss(canvas.background as RenderFill);
  const html =
    `<div class="artboard" style="position:relative;width:${width}px;height:${height}px;` +
    `overflow:hidden;background:${bg}">${body}</div>`;

  return { html, missing: [...new Set(missing)] };
}

export interface SheetOptions {
  /** Coupons per A4 page. Drives the grid, not the card size. Ignored when
   *  sizeMm is present — see cellsForSize() below. */
  perPage?: 1 | 2 | 4 | 6 | 8 | 10 | 12;
  /** Real physical cell size to print at — e.g. the Print Coupon modal's own
   *  Small/Medium/Large/Custom (see couponPrintSheet.ts on the frontend,
   *  same concept, re-derived here since this module has no shared package
   *  with it). When set, this DRIVES the grid (how many of this exact size
   *  fit on A4), the inverse of perPage above (which fixes the grid and lets
   *  the cell size fall out of it). The two are mutually exclusive; sizeMm
   *  wins if both are somehow sent. */
  sizeMm?: { width: number; height: number };
  cropMarks?: boolean;
  /** mm of bleed on each edge. 0 disables the bleed box entirely. */
  bleedMm?: number;
  /** Total copies wanted, spanning as many A4 pages as it takes. Omitted =
   *  exactly one page's worth (however many fit — see cellsForSize()), the
   *  original single-page behaviour. A value bigger than one page's worth is
   *  what makes this a MULTI-page download, not a bigger single page. */
  quantity?: number;
}

const A4_W_MM = 210, A4_H_MM = 297, PAGE_PAD_MM = 10, GAP_MM = 4;

/** Columns/rows for a per-page count that actually fits A4. */
export function sheetGrid(perPage: number): { cols: number; rows: number } {
  switch (perPage) {
    case 1: return { cols: 1, rows: 1 };
    case 2: return { cols: 1, rows: 2 };
    case 4: return { cols: 2, rows: 2 };
    case 6: return { cols: 2, rows: 3 };
    case 8: return { cols: 2, rows: 4 };
    case 10: return { cols: 2, rows: 5 };
    case 12: return { cols: 3, rows: 4 };
    default: return { cols: 2, rows: 2 };
  }
}

/** How many cells of a REAL physical size fit on one A4 page — the inverse
 *  of sheetGrid(): there the grid shape is fixed and the cell size falls
 *  out of it; here the cell size is fixed (whatever the user picked) and the
 *  grid shape falls out of how many actually fit, floor-rounded so a partial
 *  cell is never drawn. Same formula as the frontend's couponsPerSheet()
 *  (couponPrintSheet.ts) — kept in sync deliberately, since disagreeing here
 *  would mean the print modal and this designer export report a different
 *  "N per page" for the identical physical size. */
export function cellsForSize(widthMm: number, heightMm: number): { cols: number; rows: number; perPage: number } {
  const usableW = A4_W_MM - PAGE_PAD_MM * 2;
  const usableH = A4_H_MM - PAGE_PAD_MM * 2;
  const cols = Math.max(1, Math.floor((usableW + GAP_MM) / (widthMm + GAP_MM)));
  const rows = Math.max(1, Math.floor((usableH + GAP_MM) / (heightMm + GAP_MM)));
  return { cols, rows, perPage: cols * rows };
}

/** Cell dimensions in mm for whichever sheet mode is active — sizeMm's own
 *  values directly if given (the whole point: print AT that real size, not a
 *  size derived from slicing the page), otherwise A4 divided evenly by
 *  sheetGrid(perPage) as before. Single source both renderSheet() and
 *  buildDocument() read from, so the grid CSS and the per-cell scale factor
 *  can never disagree about how big a cell actually is. */
function resolveCellMm(opts: SheetOptions): { cols: number; rows: number; cellW: number; cellH: number } {
  if (opts.sizeMm) {
    const { cols, rows } = cellsForSize(opts.sizeMm.width, opts.sizeMm.height);
    return { cols, rows, cellW: opts.sizeMm.width, cellH: opts.sizeMm.height };
  }
  const { cols, rows } = sheetGrid(opts.perPage ?? 4);
  return {
    cols, rows,
    cellW: (A4_W_MM - PAGE_PAD_MM * 2 - GAP_MM * (cols - 1)) / cols,
    cellH: (A4_H_MM - PAGE_PAD_MM * 2 - GAP_MM * (rows - 1)) / rows,
  };
}

/**
 * One or more A4 pages of copies, `quantity` total (default: exactly one
 * page's worth).
 *
 * Each cell is a fixed physical size derived from the page, and the artboard is
 * SCALED to fit it — dividing the page without scaling would clip a 384px-wide
 * design into a 52mm cell at 12-up.
 *
 * Multi-page is just repeating the same single-page block N times and
 * marking every page but the last with break-after:page — Puppeteer's
 * page.pdf({format:'A4'}) paginates a tall HTML document exactly the way a
 * browser's own print-to-PDF does, so there's no separate "generate page 2"
 * call or loop over pdf() itself; one render, one PDF, however many pages
 * that document naturally contains.
 */
export function renderSheet(doc: Dict, values: Record<string, string>, opts: SheetOptions = {}): RenderResult {
  const { cols, rows, cellW, cellH } = resolveCellMm(opts);
  const perPage = cols * rows;
  // Never below perPage — a quantity smaller than one page's worth still
  // fills that one page's grid to keep the existing single-page look
  // (a lone coupon centered alone on an otherwise-empty A4 sheet), same as
  // before this option existed.
  const quantity = Math.max(perPage, Math.floor(opts.quantity ?? perPage));
  const totalPages = Math.ceil(quantity / perPage);
  const canvas = (doc.canvas ?? {}) as Dict;
  const dw = num(canvas.width, 384), dh = num(canvas.height, 240);

  // mm → px at 96dpi, then the scale that makes the artboard fit its cell —
  // Math.min (not the average, not width-only) so the design is never
  // stretched or overflows on whichever axis is more constraining; the design
  // keeps its own aspect ratio and any leftover space in the cell is blank
  // rather than cropped.
  const cellWpx = (cellW / 25.4) * 96, cellHpx = (cellH / 25.4) * 96;
  const scale = Math.min(cellWpx / dw, cellHpx / dh);

  const one = renderDesign(doc, values);
  const marks = opts.cropMarks
    ? `<span class="cm cm--tl"></span><span class="cm cm--tr"></span><span class="cm cm--bl"></span><span class="cm cm--br"></span>`
    : "";
  const cellHtml = `<div class="cell">${marks}<div class="fit" style="transform:scale(${scale.toFixed(4)})">${one.html}</div></div>`;

  // Last page only gets however many cells are actually left over — an
  // empty trailing cell (e.g. quantity=5 at 4-per-page) would otherwise
  // render as a blank card rather than just a shorter final page.
  const pages = Array.from({ length: totalPages }, (_, pageIndex) => {
    const remaining = quantity - pageIndex * perPage;
    const onThisPage = Math.min(perPage, remaining);
    const cells = Array.from({ length: onThisPage }, () => cellHtml).join("");
    const isLast = pageIndex === totalPages - 1;
    return `<div class="sheet${isLast ? "" : " sheet--break"}">${cells}</div>`;
  }).join("");

  return { html: pages, missing: one.missing };
}

export interface DocumentOptions {
  title?: string;
  /** Sheet mode wraps the artboard in an A4 grid; otherwise it stands alone. */
  sheet?: SheetOptions | null;
  widthPx?: number;
  heightPx?: number;
}

export function buildDocument(inner: string, opts: DocumentOptions = {}): string {
  const sheet = opts.sheet;
  const { cols, rows, cellW, cellH } = sheet ? resolveCellMm(sheet) : { cols: 2, rows: 2, cellW: 0, cellH: 0 };

  const pageCss = sheet
    ? `@page{size:A4;margin:0}`
    : `@page{size:${opts.widthPx ?? 384}px ${opts.heightPx ?? 240}px;margin:0}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(opts.title ?? "Design")}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif}
  .sheet{width:${A4_W_MM}mm;height:${A4_H_MM}mm;padding:${PAGE_PAD_MM}mm;
         display:grid;grid-template-columns:repeat(${cols},${cellW}mm);
         grid-template-rows:repeat(${rows},${cellH}mm);gap:${GAP_MM}mm;justify-content:center}
  /* Multi-page: every page but the last carries this, so Puppeteer's
     page.pdf({format:'A4'}) (and a real browser's print-to-PDF, identical
     engine) starts a fresh physical page right after it instead of letting
     two consecutive 297mm-tall .sheet blocks run together and mis-paginate
     by a fraction of a millimetre. break-after is the modern property;
     page-break-after is the same rule for Chrome/Chromium versions that
     still only understand the old name. */
  .sheet--break{break-after:page;page-break-after:always}
  .cell{position:relative;width:${cellW}mm;height:${cellH}mm;overflow:hidden;
        display:flex;align-items:center;justify-content:center;break-inside:avoid}
  .fit{transform-origin:center center}
  /* Crop marks: hairlines just inside each corner, for trimming. */
  .cm{position:absolute;width:3mm;height:3mm;pointer-events:none}
  .cm::before,.cm::after{content:"";position:absolute;background:#111}
  .cm::before{width:3mm;height:.2mm;top:0}
  .cm::after{width:.2mm;height:3mm;left:0}
  .cm--tl{top:0;left:0}.cm--tr{top:0;right:0}.cm--bl{bottom:0;left:0}.cm--br{bottom:0;right:0}
  ${pageCss}
</style></head><body>${inner}${AUTOFIT_SCRIPT}</body></html>`;
}
