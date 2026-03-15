"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.brandsController = exports.productsController = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const products_service_1 = require("./products.service");
const getBaseUrl = (req) => `${req.protocol}://${req.get("host")}`;
// ─── Products Controller ──────────────────────────────────────────────────────
exports.productsController = {
    // GET /api/v1/products
    async list(req, res, next) {
        try {
            logger_1.default.info("GET /products called", {
                requesterUserId: req.user?.userId, requesterRole: req.user?.role,
                path: req.originalUrl, method: req.method,
            });
            const { search, category_id, brand_id, retail_sales_enabled, min_price, max_price, sort_by, sort_order, page, limit, } = req.query;
            const result = await products_service_1.productsService.list({
                requesterUserId: req.user?.userId ?? "anonymous",
                requesterRole: req.user?.role,
                filters: {
                    search: search,
                    category_id: category_id,
                    brand_id: brand_id,
                    retail_sales_enabled: retail_sales_enabled !== undefined ? retail_sales_enabled === "true" : undefined,
                    min_price: min_price ? parseFloat(min_price) : undefined,
                    max_price: max_price ? parseFloat(max_price) : undefined,
                    sort_by: sort_by,
                    sort_order: sort_order,
                    page: page ? parseInt(page, 10) : undefined,
                    limit: limit ? parseInt(limit, 10) : undefined,
                },
            });
            return (0, response_util_1.sendSuccess)(res, 200, result, "Products fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /products error", { err });
            return next(err);
        }
    },
    // GET /api/v1/products/:id
    async getById(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("GET /products/:id called", { productId: id, path: req.originalUrl, method: req.method });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const product = await products_service_1.productsService.getById(id);
            return (0, response_util_1.sendSuccess)(res, 200, product, "Product fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /products/:id error", { err });
            return next(err);
        }
    },
    // POST /api/v1/products
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            logger_1.default.info("POST /products called", { userId, role, path: req.originalUrl, method: req.method });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const files = req.files ?? [];
            const baseUrl = getBaseUrl(req);
            const product = await products_service_1.productsService.create({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body,
                files: files.map((f) => ({ url: `${baseUrl}/uploads/${f.filename}`, filename: f.filename })),
            });
            return (0, response_util_1.sendSuccess)(res, 201, product, "Product created successfully");
        }
        catch (err) {
            logger_1.default.error("POST /products error", { err });
            return next(err);
        }
    },
    // PATCH /api/v1/products/:id
    async update(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("PATCH /products/:id called", {
                productId: id, requesterUserId: userId, requesterRole: role,
                path: req.originalUrl, method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await products_service_1.productsService.update({
                productId: id, requesterUserId: userId, requesterRole: role,
                patch: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Product updated successfully");
        }
        catch (err) {
            logger_1.default.error("PATCH /products/:id error", { err });
            return next(err);
        }
    },
    // DELETE /api/v1/products/:id
    async delete(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("DELETE /products/:id called", {
                productId: id, requesterUserId: userId, requesterRole: role,
                path: req.originalUrl, method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            await products_service_1.productsService.delete({ productId: id, requesterUserId: userId, requesterRole: role });
            return (0, response_util_1.sendSuccess)(res, 200, { id }, "Product deleted successfully");
        }
        catch (err) {
            logger_1.default.error("DELETE /products/:id error", { err });
            return next(err);
        }
    },
    // POST /api/v1/products/:id/photos
    async uploadPhotos(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("POST /products/:id/photos called", {
                productId: id, requesterUserId: userId, path: req.originalUrl, method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const files = req.files ?? [];
            const baseUrl = getBaseUrl(req);
            const photos = await products_service_1.productsService.uploadPhotos({
                productId: id,
                requesterUserId: userId,
                files: files.map((f) => ({ url: `${baseUrl}/uploads/${f.filename}`, filename: f.filename })),
            });
            return (0, response_util_1.sendSuccess)(res, 201, photos, "Photos uploaded successfully");
        }
        catch (err) {
            logger_1.default.error("POST /products/:id/photos error", { err });
            return next(err);
        }
    },
    // PUT /api/v1/products/:id/photos/reorder
    async reorderPhotos(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("PUT /products/:id/photos/reorder called", {
                productId: id, requesterUserId: userId, path: req.originalUrl, method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            await products_service_1.productsService.reorderPhotos({
                productId: id, requesterUserId: userId, body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, null, "Photos reordered successfully");
        }
        catch (err) {
            logger_1.default.error("PUT /products/:id/photos/reorder error", { err });
            return next(err);
        }
    },
    // DELETE /api/v1/products/:id/photos/:photoId
    async deletePhoto(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            const photoId = String(req.params.photoId || "").trim();
            logger_1.default.info("DELETE /products/:id/photos/:photoId called", {
                productId: id, photoId, requesterUserId: userId, path: req.originalUrl, method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            if (!photoId)
                throw new error_middleware_1.AppError(400, "photoId is required", "VALIDATION_ERROR");
            await products_service_1.productsService.deletePhoto({ productId: id, photoId, requesterUserId: userId });
            return (0, response_util_1.sendSuccess)(res, 200, { id: photoId }, "Photo deleted successfully");
        }
        catch (err) {
            logger_1.default.error("DELETE /products/:id/photos/:photoId error", { err });
            return next(err);
        }
    },
};
// ─── Brands Controller ────────────────────────────────────────────────────────
exports.brandsController = {
    // GET /api/v1/products/brands
    async list(req, res, next) {
        try {
            logger_1.default.info("GET /products/brands called", { path: req.originalUrl, method: req.method });
            const brands = await products_service_1.brandsService.list();
            return (0, response_util_1.sendSuccess)(res, 200, brands, "Brands fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /products/brands error", { err });
            return next(err);
        }
    },
    // GET /api/v1/products/brands/:id
    async getById(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("GET /products/brands/:id called", { brandId: id, path: req.originalUrl, method: req.method });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const brand = await products_service_1.brandsService.getById(id);
            return (0, response_util_1.sendSuccess)(res, 200, brand, "Brand fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /products/brands/:id error", { err });
            return next(err);
        }
    },
    // POST /api/v1/products/brands
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            logger_1.default.info("POST /products/brands called", { userId, role, path: req.originalUrl, method: req.method });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const brand = await products_service_1.brandsService.create({
                requesterUserId: userId, requesterRole: role, body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 201, brand, "Brand created successfully");
        }
        catch (err) {
            logger_1.default.error("POST /products/brands error", { err });
            return next(err);
        }
    },
    // PATCH /api/v1/products/brands/:id
    async update(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("PATCH /products/brands/:id called", {
                brandId: id, requesterUserId: userId, requesterRole: role,
                path: req.originalUrl, method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await products_service_1.brandsService.update({
                brandId: id, requesterUserId: userId, requesterRole: role,
                patch: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Brand updated successfully");
        }
        catch (err) {
            logger_1.default.error("PATCH /products/brands/:id error", { err });
            return next(err);
        }
    },
    // DELETE /api/v1/products/brands/:id
    async delete(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("DELETE /products/brands/:id called", {
                brandId: id, requesterUserId: userId, requesterRole: role,
                path: req.originalUrl, method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            await products_service_1.brandsService.delete({ brandId: id, requesterUserId: userId, requesterRole: role });
            return (0, response_util_1.sendSuccess)(res, 200, { id }, "Brand deleted successfully");
        }
        catch (err) {
            logger_1.default.error("DELETE /products/brands/:id error", { err });
            return next(err);
        }
    },
};
//# sourceMappingURL=products.controller.js.map