import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import ExcelJS from "exceljs";
import { productsRepository, brandsRepository } from "./products.repository";
import { categoriesRepository } from "../categories/categories.repository";
import { suppliersRepository } from "../inventory/inventory.repository";
import { CreateProductBody } from "./products.types";

interface ImportRow {
    name?: string;
    description?: string;
    barcode?: string;
    brand?: string;
    vendor?: string;
    // The product's menu CATEGORY (e.g. "Hair Care") — from the "Category"
    // column only. Was previously conflated with productType below via a
    // `||` fallback, so a sheet with BOTH columns (like the real export
    // template) silently discarded Category and created a bogus category
    // literally named "Consumable"/"Retail" instead.
    category?: string;
    // Retail / Consumable / Both — from the "Product Type" column only.
    productType?: string;
    costPrice?: number;
    fullPrice?: number;
    sellPrice?: number;
    // MRP (Maximum Retail Price) — common on Indian supplier Excel sheets.
    // Maps to retail_price; takes priority over Sell Price / Full Price.
    mrp?: number;
    // Paid Price — fallback for retail_price when MRP/Sell/Full are all absent.
    paidPrice?: number;
    qtyAlert?: number;
    inHandQuantity?: number;
    type?: string;
    hsnSac?: string;
    productUsage?: string;
}

// One entry per row that didn't cleanly import — covers both hard failures
// (bad data, rejected before ever touching the DB) and skips (valid data,
// but a duplicate already exists and updateExisting wasn't requested).
// Replaces the old bare {row, reason} shape so the UI can show the product
// name and an actionable suggestion, not just a row number.
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
    if (reason.includes("name is required")) return "Add a value in the Name column.";
    if (reason.includes("Sell price must be greater than 0")) return "Enter a Sell Price, Full Price, or MRP greater than 0.";
    if (reason.includes("Cost price cannot be negative")) return "Enter a non-negative Cost Price, or leave it blank.";
    if (reason.includes("Invalid Type")) return "Set the Type column to one of: Retail, Consumable, Both (any case).";
    if (reason.includes("barcode") && reason.includes("already exists")) return "Check 'Update existing products' to update it, or use a different Barcode to import it as new.";
    if (reason.includes("already exists") && reason.includes("name")) return "Check 'Update existing products' to update it, or change the Name/Brand/Category to import it as a distinct product.";
    return undefined;
}

// Parse CSV
function parseCSV(content: string): ImportRow[] {
    try {
        const lines = content
            .split(/\r?\n/)
            .filter((line) => line.trim());

        if (lines.length < 2) return [];

        const headers = parseCSVLine(lines[0]);

        const records: ImportRow[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);

            const row: Record<string, any> = {};

            headers.forEach((header, idx) => {
                row[header] = values[idx] || "";
            });

            records.push({
                name: row["Name"] || row["name"] || row["Product Name"],
                description: row["Description"],
                barcode: row["BarcodeID"] || row["barcode"],
                brand: row["Brand"] || row["brand"],
                vendor: row["Vendor"],
                category: row["Category"],
                productType: row["Product Type"],
                costPrice: row["Cost Price"]
                    ? parseFloat(String(row["Cost Price"]))
                    : undefined,
                fullPrice: row["Full Price"]
                    ? parseFloat(String(row["Full Price"]))
                    : undefined,
                sellPrice: row["Sell Price"]
                    ? parseFloat(String(row["Sell Price"]))
                    : undefined,
                mrp: row["MRP"] || row["mrp"] || row["M.R.P"] || row["M.R.P."]
                    ? parseFloat(String(row["MRP"] || row["mrp"] || row["M.R.P"] || row["M.R.P."]))
                    : undefined,
                paidPrice: row["Paid Price"] || row["paid_price"]
                    ? parseFloat(String(row["Paid Price"] || row["paid_price"]))
                    : undefined,
                qtyAlert: row["Qty Alert"]
                    ? parseInt(String(row["Qty Alert"]), 10)
                    : undefined,
                inHandQuantity: row["In Hand Quantity"]
                    ? parseInt(
                          String(row["In Hand Quantity"]),
                          10
                      )
                    : undefined,
                type: row["Type"],
                hsnSac: row["HSN/SAC"],
                productUsage: row["Product Usage"],
            });
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
            headers[String(cell.value).toLowerCase()] =
                colNumber;
        });

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;

            const getCell = (colName: string) => {
                const colNum =
                    headers[colName.toLowerCase()];

                return colNum
                    ? row.getCell(colNum).value
                    : undefined;
            };

            rows.push({
                name:
                    String(
                        getCell("Product Name") ||
                            getCell("Name") ||
                            ""
                    ).trim() || undefined,

                description:
                    String(
                        getCell("Description") || ""
                    ).trim() || undefined,

                barcode:
                    String(
                        getCell("BarcodeID") ||
                            getCell("Barcode") ||
                            ""
                    ).trim() || undefined,

                brand:
                    String(getCell("Brand") || "").trim() ||
                    undefined,

                vendor:
                    String(getCell("Vendor") || "").trim() ||
                    undefined,

                category:
                    String(
                        getCell("Category") || ""
                    ).trim() || undefined,

                productType:
                    String(
                        getCell("Product Type") || ""
                    ).trim() || undefined,

                costPrice: getCell("Cost Price")
                    ? parseFloat(
                          String(getCell("Cost Price"))
                      )
                    : undefined,

                fullPrice: getCell("Full Price")
                    ? parseFloat(
                          String(getCell("Full Price"))
                      )
                    : undefined,

                sellPrice: getCell("Sell Price")
                    ? parseFloat(
                          String(getCell("Sell Price"))
                      )
                    : undefined,

                mrp: getCell("MRP") || getCell("M.R.P") || getCell("M.R.P.")
                    ? parseFloat(
                          String(getCell("MRP") || getCell("M.R.P") || getCell("M.R.P."))
                      )
                    : undefined,

                paidPrice: getCell("Paid Price")
                    ? parseFloat(String(getCell("Paid Price")))
                    : undefined,

                qtyAlert: getCell("Qty Alert")
                    ? parseInt(
                          String(getCell("Qty Alert")),
                          10
                      )
                    : undefined,

                inHandQuantity: getCell(
                    "In Hand Quantity"
                )
                    ? parseInt(
                          String(
                              getCell(
                                  "In Hand Quantity"
                              )
                          ),
                          10
                      )
                    : undefined,

                type:
                    String(getCell("Type") || "").trim() ||
                    undefined,

                hsnSac:
                    String(getCell("HSN/SAC") || "").trim() ||
                    undefined,

                productUsage:
                    String(
                        getCell("Product Usage") || ""
                    ).trim() || undefined,
            });
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

const VALID_PRODUCT_TYPES = ["retail", "consumable", "both"] as const;
type ProductTypeValue = (typeof VALID_PRODUCT_TYPES)[number];

// "Retail" / "Consumable" / "Both" (any case, extra whitespace trimmed) from
// the sheet -> the DB's retail/consumable/both enum. The "Type" column is the
// primary source (that's the one product creation/edit actually uses); a
// sheet using "Product Type" instead is accepted as a fallback for backward
// compatibility. Blank/absent -> defaults to "retail" (same default the
// manual product form uses). A NON-BLANK but unrecognized value is a real
// error, not silently coerced to "retail" — the caller must reject the row.
function resolveProductType(row: ImportRow): { value: ProductTypeValue } | { error: string } {
    const raw = (row.type || row.productType || "").trim();
    if (!raw) return { value: "retail" };

    const normalized = raw.toLowerCase();
    if ((VALID_PRODUCT_TYPES as readonly string[]).includes(normalized)) {
        return { value: normalized as ProductTypeValue };
    }

    return {
        error: `Invalid Type "${raw}" — must be one of: Retail, Consumable, Both`,
    };
}

// Validate row
function validateRow(row: ImportRow): {
    valid: boolean;
    error?: string;
    data?: CreateProductBody;
} {
    if (!row.name || !row.name.trim()) {
        return {
            valid: false,
            error: "Product name is required",
        };
    }

    if (row.sellPrice && row.sellPrice <= 0) {
        return {
            valid: false,
            error:
                "Sell price must be greater than 0",
        };
    }

    if (row.costPrice && row.costPrice < 0) {
        return {
            valid: false,
            error: "Cost price cannot be negative",
        };
    }

    const productType = resolveProductType(row);
    if ("error" in productType) {
        return { valid: false, error: productType.error };
    }

    return {
        valid: true,
        data: {
            name: row.name.trim(),
            barcode:
                row.barcode &&
                row.barcode.trim() !== ""
                    ? row.barcode.trim()
                    : undefined,

            description:
                row.description &&
                row.description.trim() !== ""
                    ? row.description.trim()
                    : undefined,

            short_description:
                row.productUsage &&
                row.productUsage.trim() !== ""
                    ? row.productUsage.trim()
                    : undefined,

            product_type: productType.value,
            measure_unit: "pcs",
            amount: row.inHandQuantity || 0,
            qty_alert: row.qtyAlert || undefined,
            supply_price: row.costPrice || 0,
            retail_sales_enabled: true,
            retail_price: row.mrp || row.sellPrice || row.fullPrice || row.paidPrice || 0,
            tax_type: "gst_18",
            hsn_sac: row.hsnSac && row.hsnSac.trim() !== "" ? row.hsnSac.trim() : undefined,
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
            // up front — the old code did up to ~5 sequential SELECTs per row
            // (brand, category, supplier, barcode match, name+brand+category
            // match), so an N-row file meant ~5N round-trips before a single
            // product was even created. On a large CSV that's slow enough to
            // trip an upstream proxy/gateway timeout, which surfaces to the
            // browser as a bare "Network error" with no server response at
            // all — not a validation failure, just the request never finishing
            // in time. Four queries total instead of per-row ones.
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
                        validateRow(row);

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

                    if (row.category) {
                        const categoryId = await getOrCreateCategory(row.category, salonId, categoryCache, createdCategoryNames);
                        if (categoryId) {
                            productData.category_id = categoryId;
                        }
                    }

                    if (row.vendor) {
                        const supplierId = await getOrCreateSupplier(row.vendor, salonId, supplierCache);
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
                            // updateExisting wasn't requested — previously this
                            // was silently counted with no reason recorded at
                            // all, so a "3 skipped" summary gave no way to tell
                            // which rows or why.
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