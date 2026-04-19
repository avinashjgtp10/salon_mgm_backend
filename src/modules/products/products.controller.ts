import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { productsService, brandsService } from "./products.service";
import {
    CreateProductBody, UpdateProductBody, ReorderPhotosBody,
    CreateBrandBody, UpdateBrandBody,
} from "./products.types";

type AuthRequest = Request & {
    user?: { userId: string; role?: string };
};

const getBaseUrl = (req: Request) => `${req.protocol}://${req.get("host")}`;

// ─── Products Controller ──────────────────────────────────────────────────────

export const productsController = {
    // GET /api/v1/products
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            logger.info("GET /products called", {
                requesterUserId: req.user?.userId, requesterRole: req.user?.role,
                path: req.originalUrl, method: req.method,
            });
            const {
                search, category_id, brand_id, retail_sales_enabled,
                min_price, max_price, sort_by, sort_order, page, limit,
            } = req.query;
            const result = await productsService.list({
                requesterUserId: req.user?.userId ?? "anonymous",
                requesterRole: req.user?.role,
                filters: {
                    search: search as string | undefined,
                    category_id: category_id as string | undefined,
                    brand_id: brand_id as string | undefined,
                    retail_sales_enabled:
                        retail_sales_enabled !== undefined ? retail_sales_enabled === "true" : undefined,
                    min_price: min_price ? parseFloat(min_price as string) : undefined,
                    max_price: max_price ? parseFloat(max_price as string) : undefined,
                    sort_by: sort_by as string | undefined,
                    sort_order: sort_order as "ASC" | "DESC" | undefined,
                    page: page ? parseInt(page as string, 10) : undefined,
                    limit: limit ? parseInt(limit as string, 10) : undefined,
                },
            });
            return sendSuccess(res, 200, result, "Products fetched successfully");
        } catch (err) {
            logger.error("GET /products error", { err });
            return next(err);
        }
    },

    // GET /api/v1/products/:id
    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = String(req.params.id || "").trim();
            logger.info("GET /products/:id called", { productId: id, path: req.originalUrl, method: req.method });
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const product = await productsService.getById(id);
            return sendSuccess(res, 200, product, "Product fetched successfully");
        } catch (err) {
            logger.error("GET /products/:id error", { err });
            return next(err);
        }
    },

    // POST /api/v1/products
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            logger.info("POST /products called", { userId, role, path: req.originalUrl, method: req.method });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const files = (req.files as Express.Multer.File[]) ?? [];
            const baseUrl = getBaseUrl(req);
            const product = await productsService.create({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body as CreateProductBody,
                files: files.map((f) => ({ url: `${baseUrl}/uploads/${f.filename}`, filename: f.filename })),
            });
            return sendSuccess(res, 201, product, "Product created successfully");
        } catch (err) {
            logger.error("POST /products error", { err });
            return next(err);
        }
    },

    // PATCH /api/v1/products/:id
    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger.info("PATCH /products/:id called", {
                productId: id, requesterUserId: userId, requesterRole: role,
                path: req.originalUrl, method: req.method,
            });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await productsService.update({
                productId: id, requesterUserId: userId, requesterRole: role,
                patch: req.body as UpdateProductBody,
            });
            return sendSuccess(res, 200, updated, "Product updated successfully");
        } catch (err) {
            logger.error("PATCH /products/:id error", { err });
            return next(err);
        }
    },

    // DELETE /api/v1/products/:id
    async delete(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger.info("DELETE /products/:id called", {
                productId: id, requesterUserId: userId, requesterRole: role,
                path: req.originalUrl, method: req.method,
            });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            await productsService.delete({ productId: id, requesterUserId: userId, requesterRole: role });
            return sendSuccess(res, 200, { id }, "Product deleted successfully");
        } catch (err) {
            logger.error("DELETE /products/:id error", { err });
            return next(err);
        }
    },

    // POST /api/v1/products/:id/photos
    async uploadPhotos(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            logger.info("POST /products/:id/photos called", {
                productId: id, requesterUserId: userId, path: req.originalUrl, method: req.method,
            });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const files = (req.files as Express.Multer.File[]) ?? [];
            const baseUrl = getBaseUrl(req);
            const photos = await productsService.uploadPhotos({
                productId: id,
                requesterUserId: userId,
                files: files.map((f) => ({ url: `${baseUrl}/uploads/${f.filename}`, filename: f.filename })),
            });
            return sendSuccess(res, 201, photos, "Photos uploaded successfully");
        } catch (err) {
            logger.error("POST /products/:id/photos error", { err });
            return next(err);
        }
    },

    // PUT /api/v1/products/:id/photos/reorder
    async reorderPhotos(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            logger.info("PUT /products/:id/photos/reorder called", {
                productId: id, requesterUserId: userId, path: req.originalUrl, method: req.method,
            });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            await productsService.reorderPhotos({
                productId: id, requesterUserId: userId, body: req.body as ReorderPhotosBody,
            });
            return sendSuccess(res, 200, null, "Photos reordered successfully");
        } catch (err) {
            logger.error("PUT /products/:id/photos/reorder error", { err });
            return next(err);
        }
    },

    // DELETE /api/v1/products/:id/photos/:photoId
    async deletePhoto(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            const photoId = String(req.params.photoId || "").trim();
            logger.info("DELETE /products/:id/photos/:photoId called", {
                productId: id, photoId, requesterUserId: userId, path: req.originalUrl, method: req.method,
            });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            if (!photoId) throw new AppError(400, "photoId is required", "VALIDATION_ERROR");
            await productsService.deletePhoto({ productId: id, photoId, requesterUserId: userId });
            return sendSuccess(res, 200, { id: photoId }, "Photo deleted successfully");
        } catch (err) {
            logger.error("DELETE /products/:id/photos/:photoId error", { err });
            return next(err);
        }
    },

    async exportCSV(req: any, res: any, next: any) {
        try {
            logger.info("GET /products/export/csv called", { path: req.originalUrl });
            const { stream, filename } = await productsService.exportCSV({
                requesterUserId: req.user?.userId ?? "anonymous",
                requesterRole: req.user?.role,
            });
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            stream.pipe(res);
        } catch (err) { return next(err); }
    },

    async exportExcel(req: any, res: any, next: any) {
        try {
            logger.info("GET /products/export/excel called", { path: req.originalUrl });
            const { buffer, filename } = await productsService.exportExcel({
                requesterUserId: req.user?.userId ?? "anonymous",
                requesterRole: req.user?.role,
            });
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.send(buffer);
        } catch (err) { return next(err); }
    },

    async exportPDF(req: any, res: any, next: any) {
        try {
            logger.info("GET /products/export/pdf called", { path: req.originalUrl });
            const { stream, filename } = await productsService.exportPDF({
                requesterUserId: req.user?.userId ?? "anonymous",
                requesterRole: req.user?.role,
            });
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            stream.pipe(res);
        } catch (err) { return next(err); }
    },
};

// ─── Brands Controller ────────────────────────────────────────────────────────

export const brandsController = {
    // GET /api/v1/products/brands
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            logger.info("GET /products/brands called", { path: req.originalUrl, method: req.method });
            const brands = await brandsService.list();
            return sendSuccess(res, 200, brands, "Brands fetched successfully");
        } catch (err) {
            logger.error("GET /products/brands error", { err });
            return next(err);
        }
    },

    // GET /api/v1/products/brands/:id
    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = String(req.params.id || "").trim();
            logger.info("GET /products/brands/:id called", { brandId: id, path: req.originalUrl, method: req.method });
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const brand = await brandsService.getById(id);
            return sendSuccess(res, 200, brand, "Brand fetched successfully");
        } catch (err) {
            logger.error("GET /products/brands/:id error", { err });
            return next(err);
        }
    },

    // POST /api/v1/products/brands
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            logger.info("POST /products/brands called", { userId, role, path: req.originalUrl, method: req.method });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const brand = await brandsService.create({
                requesterUserId: userId, requesterRole: role, body: req.body as CreateBrandBody,
            });
            return sendSuccess(res, 201, brand, "Brand created successfully");
        } catch (err) {
            logger.error("POST /products/brands error", { err });
            return next(err);
        }
    },

    // PATCH /api/v1/products/brands/:id
    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger.info("PATCH /products/brands/:id called", {
                brandId: id, requesterUserId: userId, requesterRole: role,
                path: req.originalUrl, method: req.method,
            });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await brandsService.update({
                brandId: id, requesterUserId: userId, requesterRole: role,
                patch: req.body as UpdateBrandBody,
            });
            return sendSuccess(res, 200, updated, "Brand updated successfully");
        } catch (err) {
            logger.error("PATCH /products/brands/:id error", { err });
            return next(err);
        }
    },

    // DELETE /api/v1/products/brands/:id
    async delete(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger.info("DELETE /products/brands/:id called", {
                brandId: id, requesterUserId: userId, requesterRole: role,
                path: req.originalUrl, method: req.method,
            });
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            await brandsService.delete({ brandId: id, requesterUserId: userId, requesterRole: role });
            return sendSuccess(res, 200, { id }, "Brand deleted successfully");
        } catch (err) {
            logger.error("DELETE /products/brands/:id error", { err });
            return next(err);
        }
    },
};
