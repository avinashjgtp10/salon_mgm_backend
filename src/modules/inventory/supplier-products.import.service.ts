import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import ExcelJS from "exceljs";
import { productsRepository, brandsRepository } from "../products/products.repository";
import { categoriesRepository } from "../categories/categories.repository";
import { supplierProductsRepository } from "./supplier-products.repository";
import { SupplierProductImportResult } from "./supplier-products.types";

// Imports a supplier's product catalog (Excel/CSV) and matches it against
// the salon's own `products` table where possible. Mirrors
// products.import.ts's architecture (header-alias parsing, prefetch-
// everything-once, in-memory matching) but deliberately diverges on one
// point: this NEVER auto-creates a product on no-match — only lightweight
// lookups (brand/category) get auto-created. A genuinely new item is saved
// as `match_status: 'unmatched'` and surfaced for manual resolve
// (link/create_product/ignore — see supplier-products.service.ts), so a
// bad OCR'd name or a real new SKU never silently becomes a duplicate
// product without a human confirming it.

interface ImportRow {
    name?: string;
    barcode?: string;
    brand?: string;
    category?: string;
    supplierSku?: string;
    price?: number;
    hsnSac?: string;
}

const COLUMN_ALIASES: Record<keyof ImportRow, string[]> = {
    name: ["product name", "name", "item name"],
    barcode: ["barcode", "barcodeid"],
    brand: ["brand"],
    category: ["category"],
    supplierSku: ["sku", "item code", "supplier sku", "supplier item code", "product code"],
    price: ["price", "cost", "cost price", "rate", "supplier price"],
    hsnSac: ["hsn/sac", "hsn sac", "hsn"],
};

const NUMBER_FIELDS = new Set<keyof ImportRow>(["price"]);

// Strips the sample template's "*" required-field markers and collapses
// whitespace — same fix products.import.ts's normalizeHeaderKey applies
// (see that file's comment for the bug this avoids).
function normalizeHeaderKey(h: string): string {
    return String(h ?? "")
        .toLowerCase()
        .replace(/\*/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function buildRow(get: (aliases: string[]) => any): ImportRow {
    const row: any = {};
    for (const key of Object.keys(COLUMN_ALIASES) as (keyof ImportRow)[]) {
        const raw = get(COLUMN_ALIASES[key]);
        if (NUMBER_FIELDS.has(key)) {
            const str = raw == null ? "" : String(raw).trim();
            row[key] = str === "" ? undefined : parseFloat(str);
            continue;
        }
        const str = raw == null ? "" : String(raw).trim();
        row[key] = str === "" ? undefined : str;
    }
    return row as ImportRow;
}

function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let insideQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') insideQuotes = !insideQuotes;
        else if (char === "," && !insideQuotes) {
            result.push(current.trim().replace(/^"|"$/g, ""));
            current = "";
        } else current += char;
    }
    result.push(current.trim().replace(/^"|"$/g, ""));
    return result;
}

function parseCSV(content: string): ImportRow[] {
    try {
        const lines = content.split(/\r?\n/).filter((line) => line.trim());
        if (lines.length < 2) return [];
        const headers = parseCSVLine(lines[0]).map(normalizeHeaderKey);
        const records: ImportRow[] = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            const cellByHeader: Record<string, string> = {};
            headers.forEach((header, idx) => { cellByHeader[header] = values[idx] ?? ""; });
            records.push(buildRow((aliases) => {
                for (const alias of aliases) {
                    if (cellByHeader[alias] !== undefined && cellByHeader[alias] !== "") return cellByHeader[alias];
                }
                return undefined;
            }));
        }
        return records;
    } catch (error) {
        throw new AppError(400, `CSV Parse Error: ${String(error)}`, "CSV_PARSE_ERROR");
    }
}

async function parseExcel(buffer: Buffer): Promise<ImportRow[]> {
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const worksheet = workbook.getWorksheet(1);
        if (!worksheet) throw new Error("No worksheet found");

        const rows: ImportRow[] = [];
        const headers: Record<string, number> = {};
        worksheet.getRow(1).eachCell((cell, colNumber) => {
            headers[normalizeHeaderKey(String(cell.value))] = colNumber;
        });

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            rows.push(buildRow((aliases) => {
                for (const alias of aliases) {
                    const colNum = headers[alias];
                    if (colNum) {
                        const val = row.getCell(colNum).value;
                        if (val !== null && val !== undefined && val !== "") return val;
                    }
                }
                return undefined;
            }));
        });
        return rows;
    } catch (error) {
        throw new AppError(400, `Excel Parse Error: ${String(error)}`, "EXCEL_PARSE_ERROR");
    }
}

async function getOrCreateBrand(brandName: string, salonId: string, cache: Map<string, string>): Promise<string> {
    if (!brandName || !brandName.trim()) return "";
    const cacheKey = `${salonId}:${brandName.trim().toLowerCase()}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;
    try {
        const existing = await brandsRepository.findByName(brandName.trim(), salonId);
        if (existing) { cache.set(cacheKey, existing.id); return existing.id; }
        const created = await brandsRepository.create({ name: brandName.trim() }, salonId);
        cache.set(cacheKey, created.id);
        return created.id;
    } catch (error) {
        logger.warn(`Failed to create brand: ${brandName}`, { error });
        return "";
    }
}

async function getOrCreateCategory(categoryName: string, salonId: string, cache: Map<string, string>): Promise<string> {
    if (!categoryName || !categoryName.trim()) return "";
    const trimmed = categoryName.trim();
    const cacheKey = `${salonId}:${trimmed.toLowerCase()}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;
    try {
        const existing = await categoriesRepository.findByName(trimmed, salonId);
        if (existing) { cache.set(cacheKey, existing.id); return existing.id; }
        const created = await categoriesRepository.create(salonId, { name: trimmed, type: "product" });
        cache.set(cacheKey, created.id);
        return created.id;
    } catch (error) {
        logger.warn(`Failed to create category: ${categoryName}`, { error });
        return "";
    }
}

const nameBrandCategoryKey = (name: string, brandId: string | null, categoryId: string | null) =>
    `${name.trim().toLowerCase()}|${brandId ?? ""}|${categoryId ?? ""}`;

export const supplierProductsImportService = {
    async importCatalog(params: {
        file: Buffer; filename: string; salonId: string; supplierId: string;
    }): Promise<SupplierProductImportResult> {
        const { file, filename, salonId, supplierId } = params;

        const result: SupplierProductImportResult = {
            total: 0, matched: 0, unmatched: 0, updated: 0, failed: 0, issues: [],
        };

        const isExcel = filename.toLowerCase().endsWith(".xlsx") || filename.toLowerCase().endsWith(".xls");
        const rows = isExcel ? await parseExcel(file) : parseCSV(file.toString("utf-8"));

        if (rows.length === 0) {
            throw new AppError(400, "No data found in file", "EMPTY_FILE");
        }
        result.total = rows.length;

        // Prefetch everything the row loop needs once, up front — same
        // reasoning as products.import.ts (avoids an N-row file firing
        // several sequential SELECTs per row).
        const [existingCatalog, existingBrands, existingCategories, existingProducts] = await Promise.all([
            supplierProductsRepository.listMinimalForDedupe(supplierId, salonId),
            brandsRepository.list(salonId),
            categoriesRepository.listBySalonId(salonId),
            productsRepository.listMinimalForImport(salonId),
        ]);

        const brandCache = new Map<string, string>();
        const categoryCache = new Map<string, string>();
        for (const b of existingBrands) brandCache.set(`${salonId}:${b.name.trim().toLowerCase()}`, b.id);
        for (const c of existingCategories) categoryCache.set(`${salonId}:${c.name.trim().toLowerCase()}`, c.id);

        const productsByBarcode = new Map<string, { id: string }>();
        const productsByNameBrandCategory = new Map<string, { id: string }>();
        for (const p of existingProducts) {
            if (p.barcode) productsByBarcode.set(p.barcode, { id: p.id });
            productsByNameBrandCategory.set(nameBrandCategoryKey(p.name, p.brand_id, p.category_id), { id: p.id });
        }

        const catalogByBarcode = new Map<string, typeof existingCatalog[number]>();
        const catalogBySupplierSku = new Map<string, typeof existingCatalog[number]>();
        const catalogByNameBrandCategory = new Map<string, typeof existingCatalog[number]>();
        for (const c of existingCatalog) {
            if (c.barcode) catalogByBarcode.set(c.barcode, c);
            if (c.supplier_sku) catalogBySupplierSku.set(c.supplier_sku, c);
            catalogByNameBrandCategory.set(nameBrandCategoryKey(c.name, c.brand_id, c.category_id), c);
        }

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowIndex = i + 2;

            try {
                if (!row.name || !row.name.trim()) {
                    result.issues.push({ row: rowIndex, status: "failed", reason: "Product name is required" });
                    result.failed++;
                    continue;
                }
                if (row.price !== undefined && row.price < 0) {
                    result.issues.push({ row: rowIndex, name: row.name, status: "failed", reason: "Price cannot be negative" });
                    result.failed++;
                    continue;
                }

                const name = row.name.trim();
                const barcode = row.barcode?.trim() || null;
                const supplierSku = row.supplierSku?.trim() || null;
                const price = row.price ?? null;
                const hsnSac = row.hsnSac?.trim() || null;
                const brandId = (await getOrCreateBrand(row.brand || "", salonId, brandCache)) || null;
                const categoryId = (await getOrCreateCategory(row.category || "", salonId, categoryCache)) || null;

                // ── Stage 1: catalog-level dedupe (re-import of the same
                // supplier's sheet) — barcode -> supplier_sku -> name+brand+category.
                let catalogMatch = barcode ? catalogByBarcode.get(barcode) : undefined;
                if (!catalogMatch && supplierSku) catalogMatch = catalogBySupplierSku.get(supplierSku);
                if (!catalogMatch) catalogMatch = catalogByNameBrandCategory.get(nameBrandCategoryKey(name, brandId, categoryId));

                if (catalogMatch) {
                    // product_id deliberately never touched — preserves any
                    // prior link/create_product resolution.
                    await supplierProductsRepository.updateFromReimport(catalogMatch.id, {
                        name, barcode, brandId, categoryId, price, hsnSac,
                    });
                    if (barcode) catalogByBarcode.set(barcode, catalogMatch);
                    if (supplierSku) catalogBySupplierSku.set(supplierSku, catalogMatch);
                    catalogByNameBrandCategory.set(nameBrandCategoryKey(name, brandId, categoryId), catalogMatch);

                    result.updated++;
                    if (catalogMatch.product_id) result.matched++; else result.unmatched++;
                    continue;
                }

                // ── Stage 2 (new catalog rows only): match against products.
                let productMatch = barcode ? productsByBarcode.get(barcode) : undefined;
                if (!productMatch) productMatch = productsByNameBrandCategory.get(nameBrandCategoryKey(name, brandId, categoryId));

                const inserted = await supplierProductsRepository.insert({
                    salonId, supplierId, productId: productMatch?.id ?? null,
                    name, barcode, brandId, categoryId, supplierSku, price, hsnSac,
                    matchStatus: productMatch ? "matched" : "unmatched",
                });

                // Register the new catalog row so a later row in the SAME
                // file referencing it again is caught as a stage-1 match
                // instead of creating a duplicate.
                const asMinimal = { id: inserted.id, barcode, supplier_sku: supplierSku, name, brand_id: brandId, category_id: categoryId, product_id: productMatch?.id ?? null };
                if (barcode) catalogByBarcode.set(barcode, asMinimal);
                if (supplierSku) catalogBySupplierSku.set(supplierSku, asMinimal);
                catalogByNameBrandCategory.set(nameBrandCategoryKey(name, brandId, categoryId), asMinimal);

                if (productMatch) result.matched++; else result.unmatched++;
            } catch (error) {
                const reason = error instanceof AppError ? error.message : String(error);
                result.issues.push({ row: rowIndex, name: row.name?.trim(), status: "failed", reason });
                result.failed++;
            }
        }

        logger.info("supplier catalog import completed", {
            filename, supplierId, total: result.total, matched: result.matched,
            unmatched: result.unmatched, updated: result.updated, failed: result.failed,
        });

        return result;
    },
};
