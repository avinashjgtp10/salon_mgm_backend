import config from "../../config/env";

// The PDF is rendered by Chromium from an HTML string, so it has no page URL to resolve a relative logo path against:
// a salon logo stored as "/uploads/..." showed as a broken image. Same fix as sales/receipt-html.template.ts: point a
// relative path at this backend (the PDF is rendered on the same process, so localhost is always reachable). An
// absolute URL (S3 / older rows) is left as it is.
export function pdfLogoUrl(logoUrl: string | null | undefined): string | null {
    const raw = (logoUrl ?? "").trim();
    if (!raw) return null;
    return raw.startsWith("/") ? `http://localhost:${config.port}${raw}` : raw;
}
