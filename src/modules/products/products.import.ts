import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import ExcelJS from "exceljs";
import { productsRepository, brandsRepository } from "./products.repository";
import { categoriesRepository } from "../categories/categories.repository";
import { suppliersRepository } from "../inventory/inventory.repository";
import { CreateProductBody } from "./products.types";

// Mirrors ProductFormPage.tsx (the "Add Product" page) — every field below,
// its required-ness, and its validation rule exists there first. This file
// is meant to accept the same data through a spreadsheet instead of the
// form, not a looser/different schema. Column names accept a couple of
// common aliases (case-insensitive) so existing sheets built against the
// old template still mostly work, but the *rules* now match the form.
interface ImportRow {
    name?: string;
    barcode?: string;
    category?: string;
    brand?: string;
    supplier?: string;
    description?: string;
    remark?: string;
    // Retail / Consumable / Both — matches ProductFormPage's Product Type toggle.
    productType?: string;
    // "Stock Quantity" (retail) / "Product Quantity" (consumable) on the form —
    // one column here, same as the form uses one state var (productQty) for both.
    stockQuantity?: number;
    // "Unit Size *" on the form — required when Product Type is Consumable/Both,
    // meaningless (and ignored) for a plain Retail product.
    unitSize?: number;
    // "Unit" dropdown on the form (ml/L/g/kg/pcs/bottle/tube/pack/box/roll).
    measureUnit?: string;
    qtyAlert?: number;
    lotNumber?: string;
    supplyPrice?: number;
    taxType?: string;
    customTaxRate?: number;
    taxGroup?: string;
    hsnSac?: string;
    // "YYYY-MM-DD", once parsed — see parseDateCell.
    expiryDate?: string;
    isPublic?: boolean;
    // Retail Price fallback chain — same priority order validateRow already
    // used before this rewrite (MRP > Sell Price > Full Price > Paid Price),
    // kept as-is since it's a genuinely useful convenience for Indian
    // supplier sheets that label the same column differently.
    retailPrice?: number;
    mrp?: number;
    sellPrice?: number;
    fullPrice?: number;
    paidPrice?: number;
}

// One entry per row that didn't cleanly import — covers both hard failures
// (bad data, rejected before ever touching the DB) and skips (valid data,
// but a duplicate already exists and updateExisting wasn't requested).
interface ImportIssue {
    row: number;
    name?: string;
    status: "failed" | "skipped";
    reason: string;
    suggestion?: string;
}

interface ImportResult {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    categoriesCreated: string[];
    issues: ImportIssue[];
}

// Maps a validation/skip reason to a short, actionable next step. Matched by
// substring against the reason text rather than an error-code enum, since
// that's what validateRow already produces — avoids a second parallel
// classification system that could drift out of sync with the messages.
function suggestionFor(reason: string): string | undefined {
    if (reason.includes("name is required")) return "Add a value in the Product Name column.";
    if (reason.includes("100 characters")) return "Shorten the Product Name to 100 characters or fewer.";
    if (reason.includes("Category is required")) return "Add a value in the Category column.";
    if (reason.includes("Stock Quantity is required")) return "Add a Stock Quantity of 0 or more.";
    if (reason.includes("Unit Size is required")) return "Add a Unit Size — required for Consumable/Both products.";
    if (reason.includes("Low Stock Alert must be less than")) return "Lower the Low Stock Alert below the Stock Quantity, or leave it blank.";
    if (reason.includes("Retail Price is required")) return "Add a Retail Price (or MRP/Sell Price/Full Price/Paid Price) greater than 0.";
    if (reason.includes("Cost price cannot be negative") || reason.includes("Supply Price cannot be negative")) return "Enter a non-negative Supply Price, or leave it blank.";
    if (reason.includes("Invalid Product Type")) return "Set Product Type to one of: Retail, Consumable, Both (any case).";
    if (reason.includes("Invalid Unit")) return "Set Unit to one of: ml, L, g, kg, pcs, bottle, tube, pack, box, roll.";
    if (reason.includes("Invalid Tax Type")) return "Set Tax Type to one of: No Tax, GST 5%, GST 12%, GST 18%, GST 28%, Custom.";
    if (reason.includes("Invalid Expiry Date")) return "Use DD-MM-YYYY or YYYY-MM-DD for Expiry Date.";
    if (reason.includes("Expiry Date cannot be in the past")) return "Use today's date or a future date, or leave Expiry Date blank.";
    if (reason.includes("Category") && reason.includes("could not be created")) return "Try the import again, or create the category manually first.";
    if (reason.includes("barcode") && reason.includes("already exists")) return "Check 'Update existing products' to update it, or use a different Barcode to import it as new.";
    if (reason.includes("already exists") && reason.includes("name")) return "Check 'Update existing products' to update it, or change the Name/Brand/Category to import it as a distinct product.";
    return undefined;
}

// ─── Column aliases ─────────────────────────────────────────────────────────
// Every key a row can be read from, lowercased. First match wins. Kept
// case-insensitive and alias-tolerant (not just the new canonical header) so
// sheets built against the pre-rewrite template still import.
const COLUMN_ALIASES: Record<keyof ImportRow, string[]> = {
    name: ["product name", "name"],
    barcode: ["barcode", "barcodeid"],
    category: ["category"],
    brand: ["brand"],
    supplier: ["supplier", "vendor"],
    description: ["description"],
    remark: ["remark", "remarks"],
    productType: ["product type", "type"],
    stockQuantity: ["stock quantity", "product quantity", "quantity", "in hand quantity"],
    unitSize: ["unit size", "bottle size"],
    measureUnit: ["unit", "measure unit"],
    qtyAlert: ["low stock alert", "qty alert"],
    lotNumber: ["lot number"],
    supplyPrice: ["supply price", "cost price"],
    taxType: ["tax type"],
    customTaxRate: ["custom tax rate"],
    taxGroup: ["tax group"],
    hsnSac: ["hsn/sac", "hsn sac", "hsn"],
    expiryDate: ["expiry date"],
    isPublic: ["is public"],
    retailPrice: ["retail price"],
    mrp: ["mrp", "m.r.p", "m.r.p."],
    sellPrice: ["sell price"],
    fullPrice: ["full price"],
    paidPrice: ["paid price"],
};

const NUMBER_FIELDS = new Set<keyof ImportRow>([
    "stockQuantity", "unitSize", "qtyAlert", "supplyPrice", "customTaxRate",
    "retailPrice", "mrp", "sellPrice", "fullPrice", "paidPrice",
]);

// Shared row-builder for both CSV and Excel — `get(aliases)` returns the raw
// cell value for the first alias present, however the caller wants to look
// it up (a plain object for CSV, worksheet cells for Excel).
function buildRow(get: (aliases: string[]) => any): ImportRow {
    const row: any = {};
    for (const key of Object.keys(COLUMN_ALIASES) as (keyof ImportRow)[]) {
        const raw = get(COLUMN_ALIASES[key]);
        if (key === "isPublic") {
            const str = raw == null ? "" : String(raw).trim();
            row[key] = str === "" ? undefined : /^(y|yes|true|1)$/i.test(str);
            continue;
        }
        if (key === "expiryDate") {
            row[key] = parseDateCell(raw);
            continue;
        }
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

// Excel date cells arrive as JS Date objects; CSV/typed cells arrive as
// "DD-MM-YYYY" (matching the Add Product form's own dd-mm-yyyy display) or
// "YYYY-MM-DD" (ISO, matching what the form stores/sends). Anything else
// (including an unparseable non-blank string) returns the special
// "invalid" marker so validateRow can tell "blank" apart from "garbage".
const INVALID_DATE = "__invalid__";
function parseDateCell(value: any): string | undefined {
    if (value == null || value === "") return undefined;
    if (value instanceof Date) {
        if (isNaN(value.getTime())) return INVALID_DATE;
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }
    const str = String(value).trim();
    if (!str) return undefined;
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return INVALID_DATE;
}

// Parse CSV
function parseCSV(content: string): ImportRow[] {
    try {
        const lines = content
            .split(/\r?\n/)
            .filter((line) => line.trim());

        if (lines.length < 2) return [];

        const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
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
        throw new AppError(
            400,
            `CSV Parse Error: ${String(error)}`,
            "CSV_PARSE_ERROR"
        );
    }
}

function parseCSVLine(line: string): string[] {
    const result: string[] = [];

    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            insideQuotes = !insideQuotes;
        } else if (char === "," && !insideQuotes) {
            result.push(
                current.trim().replace(/^"|"$/g, "")
            );
            current = "";
        } else {
            current += char;
        }
    }

    result.push(current.trim().replace(/^"|"$/g, ""));

    return result;
}

// Parse Excel
async function parseExcel(
    buffer: Buffer
): Promise<ImportRow[]> {
    try {
        const workbook = new ExcelJS.Workbook();

        await workbook.xlsx.load(buffer as any);

        const worksheet = workbook.getWorksheet(1);

        if (!worksheet) {
            throw new Error("No worksheet found");
        }

        const rows: ImportRow[] = [];
        const headers: Record<string, number> = {};

        worksheet.getRow(1).eachCell((cell, colNumber) => {
            headers[String(cell.value).toLowerCase()] = colNumber;
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
        throw new AppError(
            400,
            `Excel Parse Error: ${String(error)}`,
            "EXCEL_PARSE_ERROR"
        );
    }
}

const MAX_NAME_LENGTH = 100;

const VALID_PRODUCT_TYPES = ["retail", "consumable", "both"] as const;
type ProductTypeValue = (typeof VALID_PRODUCT_TYPES)[number];

// "Retail" / "Consumable" / "Both" (any case, extra whitespace trimmed) —
// same three values as ProductFormPage's Product Type toggle, same "retail"
// default. A NON-BLANK but unrecognized value is a real error, not silently
// coerced to "retail".
function resolveProductType(raw?: string): { value: ProductTypeValue } | { error: string } {
    const trimmed = (raw || "").trim();
    if (!trimmed) return { value: "retail" };

    const normalized = trimmed.toLowerCase();
    if ((VALID_PRODUCT_TYPES as readonly string[]).includes(normalized)) {
        return { value: normalized as ProductTypeValue };
    }

    return {
        error: `Invalid Product Type "${raw}" — must be one of: Retail, Consumable, Both`,
    };
}

const VALID_UNITS = ["ml", "l", "g", "kg", "pcs", "bottle", "tube", "pack", "box", "roll"];
// Canonical casing to store — matches ProductFormPage's PRODUCT_UNITS list
// (VALID_UNITS above is only the lowercased lookup set).
const UNIT_CANONICAL: Record<string, string> = {
    ml: "ml", l: "L", g: "g", kg: "kg", pcs: "pcs",
    bottle: "bottle", tube: "tube", pack: "pack", box: "box", roll: "roll",
};

function resolveUnit(raw: string | undefined, isConsumable: boolean): { value: string } | { error: string } {
    // Retail-only products are a plain unit count on the form too — no
    // measurement unit selector, always "pcs" regardless of what's in the
    // sheet (mirrors the form forcing unit -> "pcs" the moment Product Type
    // is set to Retail).
    if (!isConsumable) return { value: "pcs" };

    const trimmed = (raw || "").trim();
    if (!trimmed) return { value: "ml" }; // form's own default when switching to consumable

    const normalized = trimmed.toLowerCase();
    if (VALID_UNITS.includes(normalized)) return { value: UNIT_CANONICAL[normalized] };

    return { error: `Invalid Unit "${raw}" — must be one of: ml, L, g, kg, pcs, bottle, tube, pack, box, roll` };
}

const VALID_TAX_TYPES: Record<string, string> = {
    notax: "no_tax", no_tax: "no_tax",
    gst5: "gst_5", gst_5: "gst_5",
    gst12: "gst_12", gst_12: "gst_12",
    gst18: "gst_18", gst_18: "gst_18",
    gst28: "gst_28", gst_28: "gst_28",
    custom: "custom",
};

function resolveTaxType(raw?: string): { value: string } | { error: string } {
    const trimmed = (raw || "").trim();
    if (!trimmed) return { value: "no_tax" }; // same default products.repository.create() itself falls back to

    const normalized = trimmed.toLowerCase().replace(/[%\s]/g, "");
    if (VALID_TAX_TYPES[normalized]) return { value: VALID_TAX_TYPES[normalized] };

    return { error: `Invalid Tax Type "${raw}" — must be one of: No Tax, GST 5%, GST 12%, GST 18%, GST 28%, Custom` };
}

// Validate row — same required fields and rules as ProductFormPage's
// isValid/*Error checks. See that page for the source of truth; this is
// meant to accept the same data through a spreadsheet, not a looser schema.
function validateRow(row: ImportRow, todayIso: string): {
    valid: boolean;
    error?: string;
    data?: CreateProductBody;
} {
    if (!row.name || !row.name.trim()) {
        return { valid: false, error: "Product name is required" };
    }
    if (row.name.trim().length > MAX_NAME_LENGTH) {
        return { valid: false, error: `Product name must be ${MAX_NAME_LENGTH} characters or fewer` };
    }

    if (!row.category || !row.category.trim()) {
        return { valid: false, error: "Category is required" };
    }

    const productType = resolveProductType(row.productType);
    if ("error" in productType) return { valid: false, error: productType.error };
    const isConsumable = productType.value === "consumable" || productType.value === "both";
    const sellsRetail = productType.value === "retail" || productType.value === "both";

    if (row.stockQuantity === undefined || row.stockQuantity < 0) {
        return { valid: false, error: "Stock Quantity is required" };
    }

    if (isConsumable && !(row.unitSize && row.unitSize > 0)) {
        return { valid: false, error: "Unit Size is required for Consumable/Both products" };
    }

    const unit = resolveUnit(row.measureUnit, isConsumable);
    if ("error" in unit) return { valid: false, error: unit.error };

    if (row.qtyAlert !== undefined && row.stockQuantity > 0 && row.qtyAlert >= row.stockQuantity) {
        return { valid: false, error: "Low Stock Alert must be less than the Stock Quantity" };
    }

    if (row.supplyPrice !== undefined && row.supplyPrice < 0) {
        return { valid: false, error: "Supply Price cannot be negative" };
    }

    const taxType = resolveTaxType(row.taxType);
    if ("error" in taxType) return { valid: false, error: taxType.error };

    if (row.expiryDate === INVALID_DATE) {
        return { valid: false, error: "Invalid Expiry Date — use DD-MM-YYYY or YYYY-MM-DD" };
    }
    if (row.expiryDate && row.expiryDate < todayIso) {
        return { valid: false, error: "Expiry Date cannot be in the past" };
    }

    // Same MRP > Sell Price > Full Price > Paid Price > Retail Price priority
    // as before this rewrite, now just also required when the product sells
    // retail — a Consumable-only row doesn't need a retail price at all.
    const retailPrice = row.mrp ?? row.sellPrice ?? row.fullPrice ?? row.paidPrice ?? row.retailPrice;
    if (sellsRetail && !(retailPrice && retailPrice > 0)) {
        return { valid: false, error: "Retail Price is required" };
    }

    const amount = isConsumable ? row.stockQuantity! * row.unitSize! : row.stockQuantity!;

    return {
        valid: true,
        data: {
            name: row.name.trim(),
            barcode: row.barcode?.trim() || undefined,
            description: row.description?.trim() || undefined,
            remark: row.remark?.trim() || undefined,
            product_type: productType.value,
            measure_unit: unit.value,
            amount,
            bottle_size: isConsumable ? row.unitSize : null,
            qty_alert: row.qtyAlert,
            lot_number: row.lotNumber?.trim() || undefined,
            supply_price: row.supplyPrice ?? 0,
            retail_sales_enabled: sellsRetail,
            retail_price: sellsRetail ? retailPrice : undefined,
            tax_type: taxType.value,
            custom_tax_rate: taxType.value === "custom" ? (row.customTaxRate ?? 0) : undefined,
            tax_group: row.taxGroup?.trim() || undefined,
            hsn_sac: row.hsnSac?.trim() || undefined,
            expiry_date: row.expiryDate || null,
            is_public: row.isPublic ?? true,
        },
    };
}

// Create / get brand (with per-import in-memory cache)
async function getOrCreateBrand(
    brandName: string,
    salonId: string,
    cache?: Map<string, string>
): Promise<string> {
    if (!brandName || !brandName.trim()) {
        return "";
    }

    const cacheKey = `${salonId}:${brandName.trim().toLowerCase()}`;
    if (cache && cache.has(cacheKey)) {
        return cache.get(cacheKey)!;
    }

    try {
        const existing =
            await brandsRepository.findByName(
                brandName.trim(),
                salonId
            );

        if (existing) {
            cache?.set(cacheKey, existing.id);
            return existing.id;
        }

        const newBrand =
            await brandsRepository.create(
                {
                    name: brandName.trim(),
                },
                salonId
            );

        cache?.set(cacheKey, newBrand.id);
        return newBrand.id;
    } catch (error) {
        logger.warn(
            `Failed to create brand: ${brandName}`,
            { error }
        );

        return "";
    }
}

async function getOrCreateCategory(
    categoryName: string,
    salonId: string,
    cache?: Map<string, string>,
    createdNames?: Set<string>
): Promise<string> {
    if (!categoryName || !categoryName.trim()) {
        return "";
    }

    const trimmedName = categoryName.trim();
    const cacheKey = `${salonId}:${trimmedName.toLowerCase()}`;
    if (cache && cache.has(cacheKey)) {
        return cache.get(cacheKey)!;
    }

    try {
        // Case-insensitive match (categoriesRepository.findByName does
        // LOWER(name) = LOWER($1)) so "Skin Care" and "skin care" resolve to
        // the same category instead of creating a duplicate.
        const existing = await categoriesRepository.findByName(trimmedName, salonId);

        if (existing) {
            cache?.set(cacheKey, existing.id);
            return existing.id;
        }

        const newCategory = await categoriesRepository.create(salonId, {
            name: trimmedName,
            type: "product",
        });

        cache?.set(cacheKey, newCategory.id);
        createdNames?.add(trimmedName);
        return newCategory.id;
    } catch (error) {
        logger.warn(`Failed to create category: ${categoryName}`, { error });
        return "";
    }
}

async function getOrCreateSupplier(
    supplierName: string,
    salonId: string,
    cache?: Map<string, string>
): Promise<string> {
    if (!supplierName || !supplierName.trim()) {
        return "";
    }

    const cacheKey = `${salonId}:${supplierName.trim().toLowerCase()}`;
    if (cache && cache.has(cacheKey)) {
        return cache.get(cacheKey)!;
    }

    try {
        const existing = await suppliersRepository.findByName(supplierName.trim(), salonId);

        if (existing) {
            cache?.set(cacheKey, existing.id);
            return existing.id;
        }

        const newSupplier = await suppliersRepository.create(
            { name: supplierName.trim() },
            salonId
        );

        cache?.set(cacheKey, newSupplier.id);
        return newSupplier.id;
    } catch (error) {
        logger.warn(`Failed to create supplier: ${supplierName}`, { error });
        return "";
    }
}

// Main service
export const productsImportService = {
    async importProducts(params: {
        file: Buffer;
        filename: string;
        salonId: string;
        requesterUserId: string;
        requesterRole?: string;
        updateExisting?: boolean;
    }): Promise<ImportResult> {
        const {
            file,
            filename,
            salonId,
            requesterUserId,
            updateExisting,
        } = params;

        logger.info(
            "productsImportService.importProducts called",
            {
                filename,
                salonId,
                requesterUserId,
            }
        );

        const result: ImportResult = {
            total: 0,
            success: 0,
            failed: 0,
            skipped: 0,
            categoriesCreated: [],
            issues: [],
        };

        // Per-import caches: avoid repeated DB lookups for the same brand/category/supplier
        const brandCache = new Map<string, string>();
        const categoryCache = new Map<string, string>();
        const supplierCache = new Map<string, string>();
        const createdCategoryNames = new Set<string>();
        const todayIso = new Date().toISOString().slice(0, 10);

        try {
            let rows: ImportRow[] = [];

            const isExcel =
                filename.endsWith(".xlsx") ||
                filename.endsWith(".xls");

            if (isExcel) {
                rows = await parseExcel(file);
            } else {
                const content = file.toString("utf-8");
                rows = parseCSV(content);
            }

            if (rows.length === 0) {
                throw new AppError(
                    400,
                    "No data found in file",
                    "EMPTY_FILE"
                );
            }

            result.total = rows.length;

            // Prefetch everything the row loop needs to duplicate-check once,
            // up front — an N-row file doing ~5 sequential SELECTs per row
            // (brand, category, supplier, barcode match, name+brand+category
            // match) is slow enough to trip an upstream proxy/gateway timeout
            // on a large sheet, which surfaces to the browser as a bare
            // "Network error" with no server response at all. Four queries
            // total instead of per-row ones.
            const [existingBrands, existingCategories, existingSuppliers, existingProducts] =
                await Promise.all([
                    brandsRepository.list(salonId),
                    categoriesRepository.listBySalonId(salonId),
                    suppliersRepository.listAll(salonId),
                    productsRepository.listMinimalForImport(salonId),
                ]);

            for (const b of existingBrands) {
                brandCache.set(`${salonId}:${b.name.trim().toLowerCase()}`, b.id);
            }
            for (const c of existingCategories) {
                categoryCache.set(`${salonId}:${c.name.trim().toLowerCase()}`, c.id);
            }
            for (const s of existingSuppliers) {
                supplierCache.set(`${salonId}:${s.name.trim().toLowerCase()}`, s.id);
            }

            const nameBrandCategoryKey = (name: string, brandId: string | null, categoryId: string | null) =>
                `${name.trim().toLowerCase()}|${brandId ?? ""}|${categoryId ?? ""}`;

            const productsByBarcode = new Map<string, { id: string; name: string }>();
            const productsByNameBrandCategory = new Map<string, { id: string; name: string }>();
            for (const p of existingProducts) {
                if (p.barcode) productsByBarcode.set(p.barcode, { id: p.id, name: p.name });
                productsByNameBrandCategory.set(
                    nameBrandCategoryKey(p.name, p.brand_id, p.category_id),
                    { id: p.id, name: p.name }
                );
            }

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                const rowIndex = i + 2;

                try {
                    const validation =
                        validateRow(row, todayIso);

                    if (!validation.valid) {
                        const reason = validation.error || "Validation failed";
                        result.issues.push({
                            row: rowIndex,
                            name: row.name?.trim() || undefined,
                            status: "failed",
                            reason,
                            suggestion: suggestionFor(reason),
                        });

                        result.failed++;

                        continue;
                    }

                    const productData =
                        validation.data!;

                    if (row.brand) {
                        const brandId =
                            await getOrCreateBrand(
                                row.brand,
                                salonId,
                                brandCache
                            );

                        if (brandId) {
                            productData.brand_id =
                                brandId;
                        }
                    }

                    // Category is required (validateRow already rejected a
                    // blank cell) — if resolving/creating it still comes back
                    // empty (a DB error), the row must fail rather than
                    // silently save with no category at all.
                    const categoryId = await getOrCreateCategory(row.category!, salonId, categoryCache, createdCategoryNames);
                    if (!categoryId) {
                        result.issues.push({
                            row: rowIndex,
                            name: productData.name,
                            status: "failed",
                            reason: `Category "${row.category}" could not be created`,
                            suggestion: suggestionFor("Category could not be created"),
                        });
                        result.failed++;
                        continue;
                    }
                    productData.category_id = categoryId;

                    if (row.supplier) {
                        const supplierId = await getOrCreateSupplier(row.supplier, salonId, supplierCache);
                        if (supplierId) {
                            productData.supplier_id = supplierId;
                        }
                    }

                    // Duplicate-checked against the in-memory maps built once
                    // above, not a fresh SELECT per row (see the comment where
                    // those maps are built).
                    let existingProduct: { id: string; name: string } | null = null;
                    let matchedBy: "barcode" | "name" | null = null;

                    if (productData.barcode && productsByBarcode.has(productData.barcode)) {
                        existingProduct = productsByBarcode.get(productData.barcode)!;
                        matchedBy = "barcode";
                    }

                    // No barcode match — fall back to the name+brand+category
                    // combination so imports can't create a second product that's
                    // otherwise identical to one already on file.
                    if (!existingProduct) {
                        const key = nameBrandCategoryKey(
                            productData.name,
                            productData.brand_id || null,
                            productData.category_id || null
                        );
                        if (productsByNameBrandCategory.has(key)) {
                            existingProduct = productsByNameBrandCategory.get(key)!;
                            matchedBy = "name";
                        }
                    }

                    if (existingProduct) {
                        if (updateExisting) {
                            await productsRepository.update(
                                existingProduct.id,
                                productData,
                                salonId
                            );

                            // Keep the in-memory maps current — a later row in
                            // the same file may reference this same barcode or
                            // name+brand+category combination again.
                            if (productData.barcode) {
                                productsByBarcode.set(productData.barcode, { id: existingProduct.id, name: productData.name });
                            }
                            productsByNameBrandCategory.set(
                                nameBrandCategoryKey(productData.name, productData.brand_id || null, productData.category_id || null),
                                { id: existingProduct.id, name: productData.name }
                            );

                            result.success++;
                        } else {
                            // Valid row, but a duplicate already exists and
                            // updateExisting wasn't requested.
                            const reason = matchedBy === "barcode"
                                ? `A product with barcode "${productData.barcode}" already exists.`
                                : `A product named "${productData.name}" already exists with the same brand and category.`;
                            result.issues.push({
                                row: rowIndex,
                                name: productData.name,
                                status: "skipped",
                                reason,
                                suggestion: suggestionFor(reason),
                            });

                            result.skipped++;
                        }
                    } else {
                        const created = await productsRepository.create(
                            productData,
                            salonId
                        );

                        // Register the newly created product so a later row in
                        // the same file that references the same barcode or
                        // name+brand+category is correctly caught as a
                        // duplicate instead of creating a second copy.
                        if (created.barcode) {
                            productsByBarcode.set(created.barcode, { id: created.id, name: created.name });
                        }
                        productsByNameBrandCategory.set(
                            nameBrandCategoryKey(created.name, created.brand_id, created.category_id),
                            { id: created.id, name: created.name }
                        );

                        result.success++;
                    }
                } catch (error) {
                    const reason = error instanceof AppError ? error.message : String(error);
                    result.issues.push({
                        row: rowIndex,
                        name: row.name?.trim() || undefined,
                        status: "failed",
                        reason,
                        suggestion: suggestionFor(reason),
                    });

                    result.failed++;
                }
            }

            logger.info(
                "products import completed",
                {
                    filename,
                    total: result.total,
                    success: result.success,
                    failed: result.failed,
                    skipped: result.skipped,
                    categoriesCreated: createdCategoryNames.size,
                    totalIssues: result.issues.length,
                }
            );

            return {
                total: result.total,
                success: result.success,
                failed: result.failed,
                skipped: result.skipped,
                categoriesCreated: Array.from(createdCategoryNames),
                // Every row's issue is returned (not capped) — the UI paginates
                // the on-screen list itself and needs the full set anyway to
                // build the downloadable CSV error report.
                issues: result.issues,
            };
        } catch (error) {
            logger.error(
                "productsImportService.importProducts error",
                {
                    filename,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                }
            );

            throw error;
        }
    },
};
