import sharp from "sharp";
export type PosterFormat = "post" | "story";

// Prints the poster text ON TOP of an AI-drawn background, so every word, price and number is
// spelled exactly as written (image models garble text). Layout: logo + salon name top-left,
// headline, gold offer block, optional validity pill, Book Now button, phone, and an
// address / website / Instagram bar along the bottom. The AI picture keeps its subject on the
// right, so everything sits in the left column over a dark shade.
//
// Text is SVG; the Docker image ships Noto Sans/Serif (fonts-noto-core, covers ₹), and the stacks
// below fall back to common desktop fonts in dev.
const SERIF = "'Noto Serif', 'DejaVu Serif', Georgia, 'Times New Roman', serif";
const SANS = "'Noto Sans', 'Segoe UI', Arial, Helvetica, sans-serif";

const SIZE: Record<PosterFormat, { w: number; h: number }> = {
    post: { w: 1080, h: 1080 },
    story: { w: 1080, h: 1920 },
};

export type PosterTextInput = {
    salonName: string;
    tagline?: string | null;
    headline: string;
    offerPre?: string | null;
    offerMain: string;
    offerPost?: string | null;
    validity?: string | null;
    cta: string;
    phone?: string | null;
    address?: string | null;
    website?: string | null;
    instagram?: string | null;
    logo?: Buffer | null;
    accentColor?: string | null;
    /** Colour of the text-side shade (default black). Coloured shades keep non-dark styles from turning muddy. */
    shadeColor?: string | null;
    /** 0–1 strength of that shade on the text side (default 0.82). */
    shadeStrength?: number;
    /** 0–1 overall darkening of the whole picture (default 0.14). */
    dim?: number;
};

const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const HEX = /^#[0-9a-fA-F]{6}$/;

function mix(hex: string, target: [number, number, number], t: number): string {
    const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const m = n.map((v, i) => Math.round(v + (target[i] - v) * t));
    return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Greedy word wrap by estimated glyph width (SVG gives no font metrics).
function wrap(text: string, charW: number, maxWidth: number, maxLines: number): string[] {
    const perLine = Math.max(4, Math.floor(maxWidth / charW));
    const lines: string[] = [];
    let cur = "";
    for (const w of text.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length > perLine && cur) {
            lines.push(cur);
            cur = w;
        } else cur = next;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "…");
        return kept;
    }
    return lines;
}

const fitSize = (text: string, maxW: number, charFactor: number, max: number, min: number) =>
    Math.max(min, Math.min(max, Math.floor(maxW / Math.max(1, text.length * charFactor))));

// A rough gold "brush stroke" outline (deterministic jitter, so the same poster always looks the same).
function brushPath(x: number, y: number, w: number, h: number): string {
    const rnd = (i: number) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const pts: Array<[number, number]> = [];
    const n = 22;
    for (let i = 0; i <= n; i++) pts.push([x + (w * i) / n + (i === 0 ? -6 : 0), y + rnd(i) * 9 + (i % 3 === 0 ? 4 : 0)]);
    for (let i = 1; i <= 5; i++) pts.push([x + w - rnd(30 + i) * 22, y + (h * i) / 6]);
    for (let i = n; i >= 0; i--) pts.push([x + (w * i) / n - (i === n ? 4 : 0), y + h - rnd(60 + i) * 9 - (i % 4 === 0 ? 5 : 0)]);
    for (let i = 5; i >= 1; i--) pts.push([x + rnd(90 + i) * 26, y + (h * i) / 6]);
    return `M ${pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(" L ")} Z`;
}

const handle = (ig: string) => {
    const m = ig.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@/, "");
    return m ? `@${m}` : "";
};
const bareSite = (s: string) => s.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

// 24×24 icon paths, drawn at ~1.15× in the accent colour.
const ICON = {
    pin: `<path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>`,
    globe: `<g fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></g>`,
    insta: `<g fill="none" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></g><circle cx="17.2" cy="6.8" r="1.2"/>`,
    phone: `<path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/>`,
    calendar: `<g fill="none" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></g>`,
};
const icon = (name: keyof typeof ICON, x: number, y: number, color: string, scale = 1.15) =>
    `<g transform="translate(${x} ${y}) scale(${scale})" fill="${name === "globe" || name === "calendar" || name === "insta" ? "none" : color}" stroke="${color}">${ICON[name]}</g>`;

export async function composePoster(background: Buffer, format: PosterFormat, t: PosterTextInput): Promise<Buffer> {
    const { w, h } = SIZE[format];
    const tall = format === "story";
    const accent = t.accentColor && HEX.test(t.accentColor) ? t.accentColor : "#c9a227";
    const goldLight = mix(accent, [255, 255, 255], 0.45);
    const goldDark = mix(accent, [0, 0, 0], 0.25);
    const ink = "#1b1206";
    const shadeC = t.shadeColor && HEX.test(t.shadeColor) ? t.shadeColor : "#000000";
    const sS = Math.max(0.2, Math.min(0.95, t.shadeStrength ?? 0.82));
    const dim = Math.max(0, Math.min(0.5, t.dim ?? 0.14));
    const left = 70;
    const COL = 640; // text column width — the picture's subject sits to the right of it
    const T = tall ? 70 : 0; // extra top padding on the tall format

    // ── Header: logo box + salon name + tagline ────────────────────────────────────
    const hasLogo = !!t.logo;
    const logoBox = 137;
    const nameX = hasLogo ? left + logoBox + 28 : left;
    const nameAvail = 700 - (nameX - left);
    const nameSize = fitSize(t.salonName, nameAvail, 0.62, 54, 30);
    const headerTop = 62 + T;
    const nameY = headerTop + (hasLogo ? 62 : 50);
    let svg = "";
    if (hasLogo) {
        svg += `<rect x="${left - 5}" y="${headerTop}" width="${logoBox}" height="${logoBox}" rx="24" fill="rgba(0,0,0,0.5)" stroke="${accent}" stroke-width="2.5"/>`;
    }
    svg += `<text x="${nameX}" y="${nameY}" font-family="${SERIF}" font-weight="700" font-size="${nameSize}" letter-spacing="3" fill="#ffffff">${esc(t.salonName.toUpperCase())}</text>`;
    if (t.tagline) {
        const tag = t.tagline.toUpperCase().slice(0, 42);
        svg += `<text x="${nameX}" y="${nameY + 34}" font-family="${SANS}" font-weight="500" font-size="21" letter-spacing="5" fill="${goldLight}">${esc(tag)}</text>`;
    }
    const headerBottom = headerTop + logoBox;

    // ── Bottom stack, anchored from the bottom so it stays tidy on both formats ─────
    const footerItems: Array<{ ic: keyof typeof ICON; text: string }> = [];
    if (t.address) footerItems.push({ ic: "pin", text: t.address });
    if (t.website) footerItems.push({ ic: "globe", text: bareSite(t.website) });
    if (t.instagram && handle(t.instagram)) footerItems.push({ ic: "insta", text: handle(t.instagram) });

    const barH = 84;
    const footerY = h - 80 - barH;
    const phoneCY = footerItems.length ? footerY - 52 : footerY + barH - 40;
    const btnH = 74;
    const btnY = phoneCY - 24 - 26 - btnH;
    const pillH = 46;
    const pillY = btnY - 22 - pillH;

    if (footerItems.length) {
        const barX = 71, barW = w - 142;
        svg += `<rect x="${barX}" y="${footerY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="rgba(0,0,0,0.55)" stroke="${accent}" stroke-opacity="0.8" stroke-width="1.5"/>`;
        // Short items (website, Instagram) get just the width they need; the address takes the rest.
        const need = (txt: string) => Math.min(330, txt.length * 12.5 + 100);
        const widths = footerItems.map((it) => (it.ic === "pin" ? 0 : need(it.text)));
        const fixed = widths.reduce((a, b) => a + b, 0);
        const flexCount = widths.filter((x) => x === 0).length;
        const colWs = widths.map((x) => (x === 0 ? (barW - fixed) / Math.max(1, flexCount) : x));
        const scale = colWs.reduce((a, b) => a + b, 0) / barW; // shrink only if the items outgrow the bar
        let cursor = barX;
        footerItems.forEach((it, i) => {
            const colW = colWs[i] / (scale > 1 ? scale : 1);
            const cx = cursor;
            cursor += colW;
            if (i > 0) svg += `<line x1="${cx}" y1="${footerY + 18}" x2="${cx}" y2="${footerY + barH - 18}" stroke="${accent}" stroke-opacity="0.5" stroke-width="1.5"/>`;
            const textX = cx + 74;
            const lines = wrap(it.text, 12.5, colW - 90, 2);
            svg += icon(it.ic, cx + 28, footerY + barH / 2 - 14, accent);
            lines.forEach((ln, k) => {
                const y = footerY + barH / 2 + (lines.length === 1 ? 8 : k === 0 ? -4 : 22);
                svg += `<text x="${textX}" y="${y}" font-family="${SANS}" font-weight="500" font-size="23" fill="#ffffff">${esc(ln)}</text>`;
            });
        });
    }

    if (t.phone) {
        svg += `<circle cx="${left + 38}" cy="${phoneCY}" r="32" fill="rgba(0,0,0,0.35)" stroke="${accent}" stroke-width="2.5"/>`;
        svg += icon("phone", left + 38 - 14, phoneCY - 14, accent, 1.17);
        svg += `<text x="${left + 92}" y="${phoneCY + 17}" font-family="${SERIF}" font-weight="700" font-size="50" fill="#ffffff">${esc(t.phone)}</text>`;
    }

    // Book Now: gold pill + dark arrow circle
    const cta = t.cta.toUpperCase();
    const ctaSize = fitSize(cta, 300, 0.78, 40, 26);
    const btnW = Math.min(COL - 40, Math.max(300, cta.length * ctaSize * 0.74 + 150));
    svg += `<rect x="${left}" y="${btnY}" width="${btnW}" height="${btnH}" rx="${btnH / 2}" fill="url(#gold)"/>`;
    svg += `<text x="${left + 40}" y="${btnY + btnH / 2 + ctaSize * 0.36}" font-family="${SANS}" font-weight="800" font-size="${ctaSize}" letter-spacing="2" fill="${ink}">${esc(cta)}</text>`;
    svg += `<circle cx="${left + btnW - 44}" cy="${btnY + btnH / 2}" r="26" fill="${ink}"/>`;
    svg += `<path d="M${left + btnW - 50} ${btnY + btnH / 2 - 11} l12 11 -12 11" fill="none" stroke="${goldLight}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;

    // Validity pill (only when the brief gave dates)
    if (t.validity) {
        const vText = t.validity.slice(0, 44);
        const vW = Math.min(COL, vText.length * 14.5 + 96);
        svg += `<rect x="${left + 4}" y="${pillY}" width="${vW}" height="${pillH}" rx="${pillH / 2}" fill="rgba(0,0,0,0.5)" stroke="${accent}" stroke-width="1.8"/>`;
        svg += icon("calendar", left + 22, pillY + 10, accent, 1.1);
        svg += `<text x="${left + 62}" y="${pillY + 31}" font-family="${SANS}" font-weight="500" font-size="25" fill="#ffffff">${esc(vText)}</text>`;
    }

    // ── Offer block: gold brush stroke with FLAT / 20% OFF / ON ALL SERVICES ─────────
    const offerBottom = (t.validity ? pillY : btnY) - 20;
    const offerH = tall ? 210 : 180;
    const offerY = offerBottom - offerH;
    const offerW = 540;
    svg += `<path d="${brushPath(left - 24, offerY, offerW, offerH)}" fill="url(#gold)"/>`;
    const main = t.offerMain.toUpperCase();
    const mainSize = fitSize(main, offerW - 150, 0.62, 112, 44);
    const pre = t.offerPre ? t.offerPre.toUpperCase().slice(0, 18) : "";
    const post = t.offerPost ? t.offerPost.toUpperCase().slice(0, 34) : "";
    const preH = pre ? 40 : 0, postH = post ? 40 : 0;
    const blockH = preH + mainSize + postH;
    let by = offerY + (offerH - blockH) / 2;
    const offX = left + 36;
    if (pre) { svg += `<text x="${offX}" y="${by + 30}" font-family="${SANS}" font-weight="700" font-size="30" letter-spacing="10" fill="${ink}">${esc(pre)}</text>`; by += preH; }
    svg += `<text x="${offX - 4}" y="${by + mainSize * 0.86}" font-family="${SERIF}" font-weight="900" font-size="${mainSize}" fill="${ink}">${esc(main)}</text>`;
    by += mainSize;
    if (post) svg += `<text x="${offX}" y="${by + 26}" font-family="${SANS}" font-weight="700" font-size="${fitSize(post, offerW - 130, 0.74, 27, 17)}" letter-spacing="6" fill="${ink}">${esc(post)}</text>`;

    // ── Headline: first half white, the rest in gold italic ──────────────────────────
    const words = t.headline.split(/\s+/).filter(Boolean);
    const k = words.length >= 2 ? Math.ceil(words.length / 2) : 0;
    const headLines = [
        ...(k > 0 ? [{ text: words.slice(0, k).join(" "), gold: false }] : []),
        { text: words.slice(k).join(" "), gold: true },
    ];
    const longest = Math.max(...headLines.map((l) => l.text.length));
    const headTop = headerBottom + (tall ? 130 : 44);
    // Biggest size that fits the column width AND leaves a gap above the offer block.
    const maxByWidth = fitSize("x".repeat(longest), COL, 0.56, tall ? 128 : 112, 40);
    const room = offerY - 28 - headTop - 40; // 40 = underline rule + breathing space
    const maxByHeight = Math.floor(room / (0.92 + (headLines.length - 1) * 1.06));
    const headSize = Math.max(40, Math.min(maxByWidth, maxByHeight));
    const headLineH = headSize * 1.06;
    headLines.forEach((l, i) => {
        const y = headTop + headSize * 0.92 + i * headLineH;
        svg += l.gold
            ? `<text x="${left}" y="${y}" font-family="${SERIF}" font-weight="800" font-style="italic" font-size="${headSize}" fill="url(#gold)">${esc(l.text)}</text>`
            : `<text x="${left}" y="${y}" font-family="${SERIF}" font-weight="800" font-size="${headSize}" fill="#ffffff">${esc(l.text)}</text>`;
    });
    const ruleY = headTop + headSize * 0.92 + (headLines.length - 1) * headLineH + 34;
    svg += `<rect x="${left}" y="${ruleY}" width="190" height="3" fill="${accent}"/>`;

    // ── Frame, shading and gradients ────────────────────────────────────────────────
    const defs = `<defs>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${goldLight}"/><stop offset="0.5" stop-color="${accent}"/><stop offset="1" stop-color="${goldDark}"/></linearGradient>
    <linearGradient id="shadeL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${shadeC}" stop-opacity="${sS}"/><stop offset="0.55" stop-color="${shadeC}" stop-opacity="${(sS * 0.67).toFixed(2)}"/><stop offset="1" stop-color="${shadeC}" stop-opacity="0"/></linearGradient>
    <linearGradient id="shadeB" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${shadeC}" stop-opacity="${Math.min(0.9, sS * 0.97).toFixed(2)}"/><stop offset="1" stop-color="${shadeC}" stop-opacity="0"/></linearGradient>
    <linearGradient id="shadeT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shadeC}" stop-opacity="${(sS * 0.6).toFixed(2)}"/><stop offset="1" stop-color="${shadeC}" stop-opacity="0"/></linearGradient>
  </defs>`;
    const shading = `<rect x="0" y="0" width="${w}" height="${h}" fill="#000" opacity="${dim}"/>
  <rect x="0" y="0" width="${w * 0.78}" height="${h}" fill="url(#shadeL)"/>
  <rect x="0" y="${h * 0.6}" width="${w}" height="${h * 0.4}" fill="url(#shadeB)"/>
  <rect x="0" y="0" width="${w}" height="${h * 0.22}" fill="url(#shadeT)"/>
  <rect x="34" y="34" width="${w - 68}" height="${h - 68}" fill="none" stroke="${accent}" stroke-opacity="0.75" stroke-width="2"/>`;

    const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${shading}${svg}</svg>`;

    const layers: sharp.OverlayOptions[] = [{ input: Buffer.from(doc), top: 0, left: 0 }];
    if (t.logo) {
        // Whole logo, never cropped or stretched: scale to fit inside the frame (with padding), then centre the
        // scaled image in the frame using its real size — a wide or tall logo is not square, so a fixed corner
        // offset would leave it hugging one side.
        const inner = logoBox - 32;
        const fitted = await sharp(t.logo)
            .resize(inner, inner, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png().toBuffer();
        const dims = await sharp(fitted).metadata();
        const fw = dims.width ?? inner, fh = dims.height ?? inner;
        layers.push({
            input: fitted,
            top: Math.round(headerTop + (logoBox - fh) / 2),
            left: Math.round(left - 5 + (logoBox - fw) / 2),
        });
    }

    return sharp(background)
        .resize(w, h, { fit: "cover", position: "centre" })
        .composite(layers)
        .jpeg({ quality: 90 })
        .toBuffer();
}
