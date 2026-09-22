import fs from "fs";
import path from "path";

/**
 * Server-side @font-face embedding for the coupon designer's decorative
 * fonts (Cinzel, Great Vibes, Playfair Display, Bebas Neue, Dancing Script).
 *
 * The editor self-hosts these via @fontsource imports in the frontend's
 * CouponDesignerPage.tsx, but Puppeteer's headless Chromium here has none of
 * them installed and, per page.setContent()'s design, fetches nothing over
 * the network — so without this every design using one of them silently
 * rendered in the browser default sans-serif, matching neither the editor
 * nor the client-side Preview popup (see the matching fix in the frontend's
 * renderHtml.ts). Font bytes are base64-inlined rather than served from a
 * URL for the same reason: setContent() has no base URL for a relative path
 * to resolve against.
 *
 * `doc.fonts` (set per-template in the frontend's core/templates.ts) says
 * which of these a given design actually uses.
 */

const FONT_FILES: Record<string, { pkg: string; weights: number[] }> = {
  "Cinzel": { pkg: "cinzel", weights: [400, 700] },
  "Great Vibes": { pkg: "great-vibes", weights: [400] },
  "Playfair Display": { pkg: "playfair-display", weights: [400, 700] },
  "Bebas Neue": { pkg: "bebas-neue", weights: [400] },
  "Dancing Script": { pkg: "dancing-script", weights: [400, 700] },
};

// Keyed by "pkg:weight" — every export in the process shares the same
// handful of font files, so there's no reason to re-read and re-encode them
// off disk on every request.
const cache = new Map<string, string>();

function embedWeightCss(pkg: string, weight: number): string {
  const key = `${pkg}:${weight}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const cssPath = require.resolve(`@fontsource/${pkg}/${weight}.css`);
  const cssDir = path.dirname(cssPath);
  const css = fs.readFileSync(cssPath, "utf8").replace(
    /url\(\.\/(files\/[\w.-]+\.(woff2?|ttf))\)/g,
    (_m: string, rel: string, ext: string) => {
      const bytes = fs.readFileSync(path.join(cssDir, rel));
      const mime = ext === "woff2" ? "font/woff2" : ext === "woff" ? "font/woff" : "font/ttf";
      return `url(data:${mime};base64,${bytes.toString("base64")})`;
    },
  );
  cache.set(key, css);
  return css;
}

/** Builds a <style> body embedding every requested family's font files. */
export function buildFontFaceCss(families: string[] | undefined): string {
  if (!families?.length) return "";
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const name of families) {
    const cfg = FONT_FILES[name];
    if (!cfg || seen.has(name)) continue;
    seen.add(name);
    for (const weight of cfg.weights) blocks.push(embedWeightCss(cfg.pkg, weight));
  }
  return blocks.join("\n");
}
