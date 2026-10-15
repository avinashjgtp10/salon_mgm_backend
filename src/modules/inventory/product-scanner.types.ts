export type ProductCandidate = {
  product_id: string | null; name: string; barcode: string | null; brand: string | null;
  variant: string | null; size: string | null; bottle_size: number | null; measure_unit: string | null;
  description: string | null; source: "salonox" | "catalog" | "vision";
  source_label: string; source_url: string | null; confidence: number | null;
};
export type ProductRecognition = { candidates: ProductCandidate[]; warnings: string[] };
export type RecognitionInput = { barcode?: string; query?: string; image?: { base64: string; mime_type: string } };

export const scannerText = (value: unknown, max = 250): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

export function normalizeCandidate(raw: Record<string, unknown>, source: ProductCandidate["source"], label: string): ProductCandidate | null {
  const name = scannerText(raw.name);
  if (!name) return null;
  const size = Number(raw.bottle_size);
  const unit = scannerText(raw.measure_unit, 20)?.toLowerCase() ?? null;
  const units = ["ml", "l", "g", "kg", "pcs", "oz", "lb", "bottle", "tube", "pack", "box", "roll"];
  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : null;
  let sourceUrl: string | null = null;
  try { const url = new URL(String(raw.source_url ?? "")); if (url.protocol === "https:") sourceUrl = url.href; } catch { /* absent provenance */ }
  return {
    // Only the database resolver may attach an internal identifier.
    product_id: null, name, barcode: scannerText(raw.barcode, 80), brand: scannerText(raw.brand),
    variant: scannerText(raw.variant), size: scannerText(raw.size),
    bottle_size: Number.isFinite(size) && size > 0 ? size : null,
    measure_unit: unit && units.includes(unit) ? unit : null,
    description: scannerText(raw.description, 1000), source, source_label: label,
    source_url: sourceUrl, confidence,
  };
}

export function barcodeAlternatives(barcode: string): string[] {
  // iOS may report UPC-A as EAN-13 with a leading zero. Never parse as a number.
  const codes = [barcode];
  if (/^0\d{12}$/.test(barcode)) codes.push(barcode.slice(1));
  if (/^\d{12}$/.test(barcode)) codes.push(`0${barcode}`);
  return codes;
}
