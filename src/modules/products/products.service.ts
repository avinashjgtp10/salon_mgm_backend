import logger from "../../config/logger";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { format } from "fast-csv";
import { PassThrough } from "stream";
import { AppError } from "../../middleware/error.middleware";
import {
    productsRepository,
    productPhotosRepository,
    brandsRepository,
} from "./products.repository";
import {
    Product, CreateProductBody, UpdateProductBody, ProductListFilters,
    ProductPhoto, ReorderPhotosBody,
    Brand, CreateBrandBody, UpdateBrandBody,
} from "./products.types";

// GST display label for exports — mirrors the frontend's TAX_TYPE_OPTIONS.
const gstLabel = (p: any): string => {
    switch (p.tax_type) {
        case "gst_5": return "GST 5%";
        case "gst_12": return "GST 12%";
        case "gst_18": return "GST 18%";
        case "gst_28": return "GST 28%";
        case "custom": return p.custom_tax_rate != null ? `Custom ${p.custom_tax_rate}%` : "Custom";
        default: return "No tax";
    }
};

const productTypeLabel = (p: any): string => {
    switch (p.product_type) {
        case "consumable": return "Consumable";
        case "both": return "Both";
        default: return "Retail";
    }
};

// ─── Products Service ─────────────────────────────────────────────────────────

export const productsService = {
    async list(params: {
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
        filters: ProductListFilters;
    }) {
        const { requesterUserId, requesterRole, salonId, filters } = params;
        logger.info("productsService.list called", { requesterUserId, requesterRole, salonId, filters });
        const page = filters.page ?? 1;
        // Guard against NaN / 0 / negative reaching Math.ceil — all map to default 20.
        const rawSize = filters.limit ?? 20;
        const pageSize = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 20;
        const { data, total } = await productsRepository.list(filters, salonId);
        return {
            data,
            page,
            pageSize,
            totalRecords: total,
            totalPages: Math.ceil(total / pageSize),
        };
    },

    async getById(id: string, salonId: string): Promise<Product & { photos: ProductPhoto[] }> {
        const product = await productsRepository.findById(id, salonId);
        if (!product) throw new AppError(404, "Product not found", "NOT_FOUND");
        const photos = await productPhotosRepository.findByProductId(id);
        return { ...product, photos };
    },

    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
        body: CreateProductBody;
        files: { url: string; filename: string }[];
    }): Promise<Product & { photos: ProductPhoto[] }> {
        const { requesterUserId, requesterRole, salonId, body, files } = params;
        logger.info("productsService.create called", { requesterUserId, requesterRole, salonId });

        if (body.barcode && body.barcode.trim()) {
            const dupBarcode = await productsRepository.findByBarcode(body.barcode.trim(), salonId);
            if (dupBarcode) {
                throw new AppError(409, "A product with the same barcode already exists.", "DUPLICATE_BARCODE");
            }
        }

        const dupCombo = await productsRepository.findByNameBrandCategory(
            body.name, body.brand_id ?? null, body.category_id ?? null, salonId
        );
        if (dupCombo) {
            throw new AppError(409, "A product with the same name, brand, and category already exists.", "DUPLICATE_PRODUCT");
        }

        const created = await productsRepository.create(body, salonId);
        let photos: ProductPhoto[] = [];
        if (files.length > 0) {
            photos = await productPhotosRepository.insertMany(created.id, files, 0);
        }
        logger.info("productsService.create success", { productId: created.id });
        return { ...created, photos };
    },

    async update(params: {
        productId: string;
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
        patch: UpdateProductBody;
    }): Promise<Product> {
        const { productId, requesterUserId, requesterRole, salonId, patch } = params;
        logger.info("productsService.update called", { productId, requesterUserId, requesterRole, salonId });
        const existing = await productsRepository.findById(productId, salonId);
        if (!existing) throw new AppError(404, "Product not found", "NOT_FOUND");

        const effectiveBarcode = patch.barcode !== undefined ? patch.barcode : existing.barcode;
        if (effectiveBarcode && effectiveBarcode.trim()) {
            const dupBarcode = await productsRepository.findByBarcode(effectiveBarcode.trim(), salonId, productId);
            if (dupBarcode) {
                throw new AppError(409, "A product with the same barcode already exists.", "DUPLICATE_BARCODE");
            }
        }

        const effectiveName = patch.name !== undefined ? patch.name : existing.name;
        const effectiveBrandId = patch.brand_id !== undefined ? patch.brand_id : existing.brand_id;
        const effectiveCategoryId = patch.category_id !== undefined ? patch.category_id : existing.category_id;
        const dupCombo = await productsRepository.findByNameBrandCategory(
            effectiveName, effectiveBrandId ?? null, effectiveCategoryId ?? null, salonId, productId
        );
        if (dupCombo) {
            throw new AppError(409, "A product with the same name, brand, and category already exists.", "DUPLICATE_PRODUCT");
        }

        const updated = await productsRepository.update(productId, patch, salonId);
        logger.info("productsService.update success", { productId: updated.id });
        return updated;
    },

    async delete(params: {
        productId: string;
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
    }): Promise<void> {
        const { productId, requesterUserId, requesterRole, salonId } = params;
        logger.info("productsService.delete called", { productId, requesterUserId, requesterRole, salonId });
        const existing = await productsRepository.findById(productId, salonId);
        if (!existing) throw new AppError(404, "Product not found", "NOT_FOUND");
        await productsRepository.delete(productId, salonId);
        logger.info("productsService.delete success", { productId });
    },

    async uploadPhotos(params: {
        productId: string;
        requesterUserId: string;
        salonId: string;
        files: { url: string; filename: string }[];
    }): Promise<ProductPhoto[]> {
        const { productId, requesterUserId, salonId, files } = params;
        logger.info("productsService.uploadPhotos called", { productId, requesterUserId, salonId });
        const existing = await productsRepository.findById(productId, salonId);
        if (!existing) throw new AppError(404, "Product not found", "NOT_FOUND");
        if (files.length === 0) throw new AppError(400, "No photos uploaded", "VALIDATION_ERROR");
        const maxOrder = await productPhotosRepository.getMaxSortOrder(productId);
        const photos = await productPhotosRepository.insertMany(productId, files, maxOrder + 1);
        logger.info("productsService.uploadPhotos success", { productId, count: photos.length });
        return photos;
    },

    async reorderPhotos(params: {
        productId: string;
        requesterUserId: string;
        salonId: string;
        body: ReorderPhotosBody;
    }): Promise<void> {
        const { productId, requesterUserId, salonId, body } = params;
        logger.info("productsService.reorderPhotos called", { productId, requesterUserId, salonId });
        const existing = await productsRepository.findById(productId, salonId);
        if (!existing) throw new AppError(404, "Product not found", "NOT_FOUND");
        const updates = body.photo_ids.map((id, i) => ({ id, sort_order: i }));
        await productPhotosRepository.reorder(updates);
        logger.info("productsService.reorderPhotos success", { productId });
    },

    async deletePhoto(params: {
        productId: string;
        photoId: string;
        requesterUserId: string;
        salonId: string;
    }): Promise<void> {
        const { productId, photoId, requesterUserId, salonId } = params;
        logger.info("productsService.deletePhoto called", { productId, photoId, requesterUserId, salonId });
        const photo = await productPhotosRepository.findById(photoId);
        if (!photo || photo.product_id !== productId) {
            throw new AppError(404, "Photo not found", "NOT_FOUND");
        }
        await productPhotosRepository.delete(photoId);
        logger.info("productsService.deletePhoto success", { photoId });
    },

    async exportCSV(params: { requesterUserId: string; requesterRole?: string; salonId: string; filters: ProductListFilters; }): Promise<{ stream: PassThrough; filename: string }> {
        logger.info("productsService.exportCSV called", { salonId: params.salonId, filters: params.filters });
        const products = await productsRepository.listExport(params.filters, params.salonId);
        const passThrough = new PassThrough();
        const csvStream = format({ headers: true });
        csvStream.pipe(passThrough);
        products.forEach((p: any) => {
            const supplyPrice = Number(p.supply_price) || 0;
            const retailPrice = p.retail_price != null ? Number(p.retail_price) : null;
            csvStream.write({
                Name: p.name, Barcode: p.barcode ?? "", Brand: p.brand_name ?? "", Category: p.category_name ?? "",
                Supplier: p.supplier_name ?? "", Product_Type: productTypeLabel(p),
                Size: p.size ?? "", Measure: p.measure_unit, Amount: p.amount,
                Supply_Price: supplyPrice, Retail_Price: retailPrice ?? "",
                // Flat markup amount (retail - supply) — not a stored column, derived
                // the same way the Create/Edit Product form's flat-markup mode does
                // (see productPricing.ts's flatAmountFromRetail on the frontend).
                Flat_Price: retailPrice != null ? (retailPrice - supplyPrice).toFixed(2) : "",
                Markup: p.markup_percentage ?? "",
                GST: gstLabel(p), HSN_SAC: p.hsn_sac ?? "",
            });
        });
        csvStream.end();
        return { stream: passThrough, filename: "products.csv" };
    },

    async exportExcel(params: { requesterUserId: string; requesterRole?: string; salonId: string; filters: ProductListFilters; }): Promise<{ buffer: Buffer; filename: string }> {
        logger.info("productsService.exportExcel called", { salonId: params.salonId, filters: params.filters });
        const products = await productsRepository.listExport(params.filters, params.salonId);
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Products");
        sheet.columns = [
            { header: "Name", key: "name", width: 30 },
            { header: "Barcode", key: "barcode", width: 20 }, { header: "Brand", key: "brand_name", width: 20 },
            { header: "Category", key: "category_name", width: 20 }, { header: "Supplier", key: "supplier_name", width: 20 },
            { header: "Product Type", key: "product_type_label", width: 14 },
            { header: "Size", key: "size", width: 12 }, { header: "Measure", key: "measure_unit", width: 12 },
            { header: "Amount", key: "amount", width: 12 }, { header: "Supply Price", key: "supply_price", width: 15 },
            { header: "Retail Price", key: "retail_price", width: 15 }, { header: "Flat Price", key: "flat_price", width: 15 },
            { header: "Markup %", key: "markup_percentage", width: 12 },
            { header: "GST", key: "gst", width: 14 }, { header: "HSN/SAC", key: "hsn_sac", width: 14 },
        ];
        sheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF101828" } };
            cell.alignment = { vertical: "middle", horizontal: "center" };
        });
        products.forEach((p: any) => {
            const supplyPrice = Number(p.supply_price) || 0;
            const retailPrice = p.retail_price != null ? Number(p.retail_price) : null;
            sheet.addRow({
                name: p.name,
                barcode: p.barcode ?? "",
                brand_name: p.brand_name ?? "",
                category_name: p.category_name ?? "",
                supplier_name: p.supplier_name ?? "",
                product_type_label: productTypeLabel(p),
                size: p.size ?? "",
                measure_unit: p.measure_unit,
                amount: p.amount,
                supply_price: supplyPrice,
                retail_price: retailPrice ?? "",
                flat_price: retailPrice != null ? Number((retailPrice - supplyPrice).toFixed(2)) : "",
                markup_percentage: p.markup_percentage ?? "",
                gst: gstLabel(p),
                hsn_sac: p.hsn_sac ?? "",
            });
        });
        const buffer = await workbook.xlsx.writeBuffer();
        return { buffer: Buffer.from(buffer), filename: "products.xlsx" };
    },

    async exportPDF(params: { requesterUserId: string; requesterRole?: string; salonId: string; filters: ProductListFilters; }): Promise<{ stream: PassThrough; filename: string }> {
        logger.info("productsService.exportPDF called", { salonId: params.salonId, filters: params.filters });
        const products = await productsRepository.listExport(params.filters, params.salonId);
        const PAGE_MARGIN = 24;
        const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4", layout: "landscape" });
        const passThrough = new PassThrough();
        doc.pipe(passThrough);
        doc.fontSize(18).font("Helvetica-Bold").text("Products Report", { align: "center" });
        doc.fontSize(10).font("Helvetica").fillColor("#666").text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
        doc.moveDown(1);

        // Table spans the full printable width (page width minus both margins)
        // instead of a hardcoded pixel width — keeps left/right whitespace equal
        // and the table filling the page regardless of page size.
        const tableX     = PAGE_MARGIN;
        const tableWidth = doc.page.width - PAGE_MARGIN * 2;
        // Proportional column widths (sum to 1) — name gets the most room since
        // it's free text, the rest are fixed-format numbers/codes.
        const colRatios = {
            name: 0.14, barcode: 0.09, brand: 0.10, supplier: 0.10, type: 0.08,
            measure: 0.09, supply: 0.10, retail: 0.10, gst: 0.09, stock: 0.11,
        };
        const colWidth  = (key: keyof typeof colRatios) => tableWidth * colRatios[key];
        let colX = tableX;
        const cols: Record<keyof typeof colRatios, number> = {} as any;
        (Object.keys(colRatios) as (keyof typeof colRatios)[]).forEach((key) => {
            cols[key] = colX;
            colX += colWidth(key);
        });

        // "₹" isn't in pdfkit's standard-font (WinAnsi) encoding and renders as
        // a mangled glyph — spell the currency out instead of using the symbol.
        const money = (n: number) => `Rs. ${n.toFixed(2)}`;

        let y = doc.y;
        const drawHeader = () => {
            doc.rect(tableX, y, tableWidth, 22).fill("#101828");
            doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
            doc.text("Name",         cols.name,     y + 7, { width: colWidth("name") - 6 });
            doc.text("Barcode",      cols.barcode,  y + 7, { width: colWidth("barcode") - 6 });
            doc.text("Brand",        cols.brand,    y + 7, { width: colWidth("brand") - 6 });
            doc.text("Supplier",     cols.supplier, y + 7, { width: colWidth("supplier") - 6 });
            doc.text("Type",         cols.type,     y + 7, { width: colWidth("type") - 6 });
            doc.text("Measure",      cols.measure,  y + 7, { width: colWidth("measure") - 6 });
            doc.text("Supply Price", cols.supply,   y + 7, { width: colWidth("supply") - 6 });
            doc.text("Retail Price", cols.retail,   y + 7, { width: colWidth("retail") - 6 });
            doc.text("GST",          cols.gst,      y + 7, { width: colWidth("gst") - 6 });
            doc.text("Stock",        cols.stock,    y + 7, { width: colWidth("stock") - 6 });
            y += 22;
        };
        drawHeader();
        products.forEach((p: any, i: number) => {
            if (y > doc.page.height - PAGE_MARGIN - 22) {
                doc.addPage({ margin: PAGE_MARGIN, size: "A4", layout: "landscape" });
                y = PAGE_MARGIN;
                drawHeader();
            }
            const bg = i % 2 === 0 ? "#F9FAFB" : "#FFFFFF";
            doc.rect(tableX, y, tableWidth, 22).fill(bg);
            doc.fillColor("#101828").fontSize(8).font("Helvetica");
            doc.text(String(p.name).substring(0, 24), cols.name, y + 7, { width: colWidth("name") - 6 });
            doc.text(String(p.barcode ?? "—"), cols.barcode, y + 7, { width: colWidth("barcode") - 6 });
            doc.text(String(p.brand_name ?? "—"), cols.brand, y + 7, { width: colWidth("brand") - 6 });
            doc.text(String(p.supplier_name ?? "—"), cols.supplier, y + 7, { width: colWidth("supplier") - 6 });
            doc.text(productTypeLabel(p), cols.type, y + 7, { width: colWidth("type") - 6 });
            doc.text(p.size ? String(p.size) : `${p.amount} ${p.measure_unit}`, cols.measure, y + 7, { width: colWidth("measure") - 6 });
            doc.text(money(Number(p.supply_price)), cols.supply, y + 7, { width: colWidth("supply") - 6 });
            doc.text(p.retail_price ? money(Number(p.retail_price)) : "—", cols.retail, y + 7, { width: colWidth("retail") - 6 });
            doc.text(gstLabel(p), cols.gst, y + 7, { width: colWidth("gst") - 6 });
            doc.text(String(p.amount ?? 0), cols.stock, y + 7, { width: colWidth("stock") - 6 });
            y += 22;
        });
        doc.end();
        return { stream: passThrough, filename: "products.pdf" };
    },
};

// ─── Brands Service ───────────────────────────────────────────────────────────

export const brandsService = {
    async list(salonId: string): Promise<Brand[]> {
        return brandsRepository.list(salonId);
    },

    async getById(id: string, salonId: string): Promise<Brand> {
        const brand = await brandsRepository.findById(id, salonId);
        if (!brand) throw new AppError(404, "Brand not found", "NOT_FOUND");
        return brand;
    },

    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
        body: CreateBrandBody;
    }): Promise<Brand> {
        const { requesterUserId, requesterRole, salonId, body } = params;
        logger.info("brandsService.create called", { requesterUserId, requesterRole, salonId });
        const existing = await brandsRepository.findByName(body.name, salonId);
        if (existing) throw new AppError(409, "A brand with this name already exists", "CONFLICT");
        const created = await brandsRepository.create(body, salonId);
        logger.info("brandsService.create success", { brandId: created.id });
        return created;
    },

    async update(params: {
        brandId: string;
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
        patch: UpdateBrandBody;
    }): Promise<Brand> {
        const { brandId, requesterUserId, requesterRole, salonId, patch } = params;
        logger.info("brandsService.update called", { brandId, requesterUserId, requesterRole, salonId });
        const existing = await brandsRepository.findById(brandId, salonId);
        if (!existing) throw new AppError(404, "Brand not found", "NOT_FOUND");
        if (patch.name) {
            const nameConflict = await brandsRepository.findByName(patch.name, salonId);
            if (nameConflict && nameConflict.id !== brandId) {
                throw new AppError(409, "A brand with this name already exists", "CONFLICT");
            }
        }
        const updated = await brandsRepository.update(brandId, patch, salonId);
        logger.info("brandsService.update success", { brandId: updated.id });
        return updated;
    },

    async delete(params: {
        brandId: string;
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
    }): Promise<void> {
        const { brandId, requesterUserId, requesterRole, salonId } = params;
        logger.info("brandsService.delete called", { brandId, requesterUserId, requesterRole, salonId });
        const existing = await brandsRepository.findById(brandId, salonId);
        if (!existing) throw new AppError(404, "Brand not found", "NOT_FOUND");
        await brandsRepository.delete(brandId, salonId);
        logger.info("brandsService.delete success", { brandId });
    },
};
