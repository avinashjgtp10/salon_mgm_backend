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
        const pageSize = filters.limit ?? 20;
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

    async exportCSV(params: { requesterUserId: string; requesterRole?: string; salonId: string; }): Promise<{ stream: PassThrough; filename: string }> {
        logger.info("productsService.exportCSV called", { salonId: params.salonId });
        const products = await productsRepository.listAll(params.salonId);
        const passThrough = new PassThrough();
        const csvStream = format({ headers: true });
        csvStream.pipe(passThrough);
        products.forEach((p: any) => {
            csvStream.write({
                ID: p.id, Name: p.name, Barcode: p.barcode ?? "", Brand: p.brand_name ?? "", Category: p.category_id ?? "",
                Measure: p.measure_unit, Amount: p.amount, Supply_Price: p.supply_price, Retail_Price: p.retail_price ?? "",
                Markup: p.markup_percentage ?? "", Tax_Type: p.tax_type, Stock: p.amount, Created_At: p.created_at,
            });
        });
        csvStream.end();
        return { stream: passThrough, filename: "products.csv" };
    },

    async exportExcel(params: { requesterUserId: string; requesterRole?: string; salonId: string; }): Promise<{ buffer: Buffer; filename: string }> {
        logger.info("productsService.exportExcel called", { salonId: params.salonId });
        const products = await productsRepository.listAll(params.salonId);
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Products");
        sheet.columns = [
            { header: "ID", key: "id", width: 36 }, { header: "Name", key: "name", width: 30 },
            { header: "Barcode", key: "barcode", width: 20 }, { header: "Brand", key: "brand_name", width: 20 },
            { header: "Category", key: "category_id", width: 20 }, { header: "Measure", key: "measure_unit", width: 12 },
            { header: "Amount", key: "amount", width: 12 }, { header: "Supply Price", key: "supply_price", width: 15 },
            { header: "Retail Price", key: "retail_price", width: 15 }, { header: "Markup %", key: "markup_percentage", width: 12 },
            { header: "Tax Type", key: "tax_type", width: 15 }, { header: "Created At", key: "created_at", width: 20 },
        ];
        sheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF101828" } };
            cell.alignment = { vertical: "middle", horizontal: "center" };
        });
        products.forEach((p: any) => {
            sheet.addRow({ ...p, brand_name: p.brand_name ?? "", category_id: p.category_id ?? "", barcode: p.barcode ?? "", retail_price: p.retail_price ?? "", markup_percentage: p.markup_percentage ?? "" });
        });
        const buffer = await workbook.xlsx.writeBuffer();
        return { buffer: Buffer.from(buffer), filename: "products.xlsx" };
    },

    async exportPDF(params: { requesterUserId: string; requesterRole?: string; salonId: string; }): Promise<{ stream: PassThrough; filename: string }> {
        logger.info("productsService.exportPDF called", { salonId: params.salonId });
        const products = await productsRepository.listAll(params.salonId);
        const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
        const passThrough = new PassThrough();
        doc.pipe(passThrough);
        doc.fontSize(18).font("Helvetica-Bold").text("Products Report", { align: "center" });
        doc.fontSize(10).font("Helvetica").fillColor("#666").text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
        doc.moveDown(1);
        const cols = { name: 40, barcode: 160, brand: 260, measure: 340, supply: 400, retail: 470, stock: 540 };
        let y = doc.y;
        doc.rect(30, y, 760, 22).fill("#101828");
        doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
        doc.text("Name", cols.name, y + 7, { width: 115 });
        doc.text("Barcode", cols.barcode, y + 7, { width: 95 });
        doc.text("Brand", cols.brand, y + 7, { width: 75 });
        doc.text("Measure", cols.measure, y + 7, { width: 55 });
        doc.text("Supply Price", cols.supply, y + 7, { width: 65 });
        doc.text("Retail Price", cols.retail, y + 7, { width: 65 });
        doc.text("Stock", cols.stock, y + 7, { width: 50 });
        y += 22;
        products.forEach((p: any, i: number) => {
            if (y > 530) { doc.addPage({ margin: 40, size: "A4", layout: "landscape" }); y = 40; }
            const bg = i % 2 === 0 ? "#F9FAFB" : "#FFFFFF";
            doc.rect(30, y, 760, 22).fill(bg);
            doc.fillColor("#101828").fontSize(8).font("Helvetica");
            doc.text(String(p.name).substring(0, 20), cols.name, y + 7, { width: 115 });
            doc.text(String(p.barcode ?? "—"), cols.barcode, y + 7, { width: 95 });
            doc.text(String(p.brand_name ?? "—"), cols.brand, y + 7, { width: 75 });
            doc.text(`${p.amount} ${p.measure_unit}`, cols.measure, y + 7, { width: 55 });
            doc.text(`₹${Number(p.supply_price).toFixed(2)}`, cols.supply, y + 7, { width: 65 });
            doc.text(p.retail_price ? `₹${Number(p.retail_price).toFixed(2)}` : "—", cols.retail, y + 7, { width: 65 });
            doc.text(String(p.amount ?? 0), cols.stock, y + 7, { width: 50 });
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
