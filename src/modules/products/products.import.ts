import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import ExcelJS from "exceljs";
import { productsRepository, brandsRepository } from "./products.repository";
import { CreateProductBody } from "./products.types";

interface ImportRow {
    name?: string;
    description?: string;
    barcode?: string;
    brand?: string;
    vendor?: string;
    productType?: string;
    costPrice?: number;
    fullPrice?: number;
    sellPrice?: number;
    qtyAlert?: number;
    inHandQuantity?: number;
    type?: string;
    hsnSac?: string;
    productUsage?: string;
}

interface ImportResult {
    success: number;
    failed: number;
    skipped: number;
    errors: Array<{
        row: number;
        reason: string;
    }>;
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
                productType:
                    row["Product Type"] || row["Category"],
                costPrice: row["Cost Price"]
                    ? parseFloat(String(row["Cost Price"]))
                    : undefined,
                fullPrice: row["Full Price"]
                    ? parseFloat(String(row["Full Price"]))
                    : undefined,
                sellPrice: row["Sell Price"]
                    ? parseFloat(String(row["Sell Price"]))
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

                productType:
                    String(
                        getCell("Product Type") ||
                            getCell("Category") ||
                            ""
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

            measure_unit: "pcs",
            amount: row.inHandQuantity || 0,
            qty_alert: row.qtyAlert || undefined,
            supply_price: row.costPrice || 0,
            retail_sales_enabled: true,
            retail_price: row.sellPrice || 0,
            tax_type: "gst_18",
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
            success: 0,
            failed: 0,
            skipped: 0,
            errors: [],
        };

        // Per-import brand cache: avoids repeated DB lookups for the same brand
        const brandCache = new Map<string, string>();

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

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                const rowIndex = i + 2;

                try {
                    const validation =
                        validateRow(row);

                    if (!validation.valid) {
                        result.errors.push({
                            row: rowIndex,
                            reason:
                                validation.error ||
                                "Validation failed",
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

                    let existingProduct = null;

                    if (productData.barcode) {
                        existingProduct =
                            await productsRepository.findByBarcode(
                                productData.barcode,
                                salonId
                            );
                    }

                    if (existingProduct) {
                        if (updateExisting) {
                            await productsRepository.update(
                                existingProduct.id,
                                productData,
                                salonId
                            );

                            result.success++;
                        } else {
                            result.skipped++;
                        }
                    } else {
                        await productsRepository.create(
                            productData,
                            salonId
                        );

                        result.success++;
                    }
                } catch (error) {
                    result.errors.push({
                        row: rowIndex,
                        reason:
                            error instanceof AppError
                                ? error.message
                                : String(error),
                    });

                    result.failed++;
                }
            }

            logger.info(
                "products import completed",
                {
                    filename,
                    success: result.success,
                    failed: result.failed,
                    skipped: result.skipped,
                    totalErrors:
                        result.errors.length,
                }
            );

            return {
                success: result.success,
                failed: result.failed,
                skipped: result.skipped,
                errors: result.errors.slice(0, 20),
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