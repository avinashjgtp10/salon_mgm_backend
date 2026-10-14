import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { productsRepository, brandsRepository } from "../products/products.repository";
import { productAuditService } from "./product-audit.service";
import { lookupExternalCatalog, recognizePackaging, searchGlobalProducts, scannerFailure } from "./product-scanner.providers";
import { barcodeAlternatives, normalizeCandidate, ProductCandidate, ProductRecognition, RecognitionInput } from "./product-scanner.types";

async function databaseBarcode(barcode: string, salonId: string): Promise<ProductCandidate | null> {
  for (const code of barcodeAlternatives(barcode)) {
    const product = await productsRepository.findByBarcode(code, salonId);
    if (product) {
      if (!product.is_active) throw new AppError(409, "This barcode belongs to an inactive product. Reactivate it before auditing; do not create a duplicate.", "PRODUCT_INACTIVE");
      const candidate = normalizeCandidate(product as unknown as Record<string, unknown>, "salonox", "SalonOX inventory")!;
      candidate.product_id = product.id;
      if (product.brand_id) {
        candidate.brand = (await brandsRepository.findById(product.brand_id, salonId))?.name ?? null;
      }
      return candidate;
    }
  }
  return null;
}
async function databaseSearch(query: string, salonId: string): Promise<ProductCandidate[]> {
  const result = await productsRepository.list({ search: query, is_active: true, page: 1, limit: 20, sort_by: "name", sort_order: "ASC" }, salonId);
  return Promise.all(result.data.map(async product => ({
    ...normalizeCandidate(product as unknown as Record<string, unknown>, "salonox", "SalonOX inventory")!,
    product_id: product.id,
    brand: product.brand_id ? (await brandsRepository.findById(product.brand_id, salonId))?.name ?? null : null,
  })));
}

export const productScannerService = {
  async recognize(auditId: string, salonId: string, input: RecognitionInput): Promise<ProductRecognition> {
    const audit = await productAuditService.getById(auditId, salonId);
    if (audit.status !== "in_progress") throw new AppError(409, "Only in-progress audits can scan products", "AUDIT_NOT_EDITABLE");
    // The branch is a branches.id, not a salons.id. Catalog/stock scoping follows
    // the existing audit repository: products belong to the authenticated salon.
    const branch = await pool.query("SELECT id FROM branches WHERE id = $1 AND salon_id = $2", [audit.branch_id, salonId]);
    if (!branch.rows.length) throw new AppError(403, "Audit branch does not belong to this salon", "INVALID_BRANCH");
    const warnings: string[] = [];
    if (input.query) {
      const existing = await databaseSearch(input.query, salonId);
      if (existing.length) return { candidates: existing, warnings };
      let candidates: ProductCandidate[] = [];
      try { candidates = await lookupExternalCatalog({ query: input.query }); }
      catch (error) { warnings.push(scannerFailure(error, "External catalog search")); }
      if (!candidates.length) {
        try { candidates = await searchGlobalProducts({ query: input.query }); }
        catch (error) { warnings.push(scannerFailure(error, "Global product search")); }
      }
      const resolved = await Promise.all(candidates.map(async candidate =>
        (candidate.barcode ? await databaseBarcode(candidate.barcode, salonId) : null) ?? candidate));
      return { candidates: resolved, warnings: [...warnings, "Verify external matches against the exact packaging before creating a product."] };
    }
    if (input.barcode) {
      const existing = await databaseBarcode(input.barcode, salonId);
      if (existing) return { candidates: [existing], warnings };
      try {
        const candidates = (await lookupExternalCatalog({ barcode: input.barcode })).filter(c => c.barcode && barcodeAlternatives(input.barcode!).includes(c.barcode));
        if (candidates.length) return { candidates, warnings };
      } catch (error) { warnings.push(scannerFailure(error, "External barcode catalog")); }
      if (!input.image) {
        try {
          const candidates = (await searchGlobalProducts({ barcode: input.barcode })).filter(c =>
            c.barcode && barcodeAlternatives(input.barcode!).includes(c.barcode));
          return { candidates, warnings: [...warnings, "Verify web search details against the barcode and packaging before saving."] };
        } catch (error) { warnings.push(scannerFailure(error, "Global barcode search")); }
      }
    }
    if (!input.image) return { candidates: [], warnings };
    let vision: ProductCandidate | null = null;
    try { vision = await recognizePackaging(input.image); }
    catch (error) { return { candidates: [], warnings: [...warnings, scannerFailure(error, "Packaging recognition")] }; }
    if (!vision || (vision.confidence !== null && vision.confidence < 0.35)) return { candidates: [], warnings: [...warnings, "The packaging is not clear enough to identify reliably. Try another photo."] };
    // An AI-read barcode is checked against the same database-first resolver.
    const readBarcode = vision.barcode && /^[A-Za-z0-9._-]{4,80}$/.test(vision.barcode) ? vision.barcode : null;
    if (readBarcode) {
      const existing = await databaseBarcode(readBarcode, salonId);
      if (existing) return { candidates: [existing], warnings: [...warnings, "Verify the barcode read from the photo against the package."] };
    }
    const local = await databaseSearch(vision.name, salonId);
    const search = [vision.brand, vision.name, vision.variant, vision.size].filter(Boolean).join(" ").slice(0, 250);
    let catalog: ProductCandidate[] = [];
    try {
      catalog = await lookupExternalCatalog(readBarcode ? { barcode: readBarcode } : { query: search });
      if (readBarcode && !catalog.length) catalog = await lookupExternalCatalog({ query: search });
    }
    catch (error) { warnings.push(scannerFailure(error, "External packaging catalog")); }
    if (!catalog.length) {
      try { catalog = await searchGlobalProducts({ query: search }); }
      catch (error) { warnings.push(scannerFailure(error, "Global packaging search")); }
    }
    // Never auto-link by a similar name; return separate choices for a manager.
    const resolved: ProductCandidate[] = [];
    for (const candidate of catalog) {
      const match = candidate.barcode ? await databaseBarcode(candidate.barcode, salonId) : null;
      resolved.push(match ?? candidate);
    }
    const candidates = [...local, ...resolved, vision].filter((candidate, index, all) => all.findIndex(p =>
      candidate.product_id ? p.product_id === candidate.product_id : p.name === candidate.name && p.barcode === candidate.barcode && p.source === candidate.source) === index).slice(0, 12);
    return { candidates, warnings: [...warnings, "Photo matches are suggestions. Check the exact brand, variant and size before saving."] };
  },
};
