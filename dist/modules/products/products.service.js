"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.brandsService = exports.productsService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const products_repository_1 = require("./products.repository");
// ─── Products Service ─────────────────────────────────────────────────────────
exports.productsService = {
    async list(params) {
        const { requesterUserId, requesterRole, filters } = params;
        logger_1.default.info("productsService.list called", { requesterUserId, requesterRole, filters });
        return products_repository_1.productsRepository.list(filters);
    },
    async getById(id) {
        const product = await products_repository_1.productsRepository.findById(id);
        if (!product)
            throw new error_middleware_1.AppError(404, "Product not found", "NOT_FOUND");
        const photos = await products_repository_1.productPhotosRepository.findByProductId(id);
        return { ...product, photos };
    },
    async create(params) {
        const { requesterUserId, requesterRole, body, files } = params;
        logger_1.default.info("productsService.create called", { requesterUserId, requesterRole });
        const created = await products_repository_1.productsRepository.create(body);
        let photos = [];
        if (files.length > 0) {
            photos = await products_repository_1.productPhotosRepository.insertMany(created.id, files, 0);
        }
        logger_1.default.info("productsService.create success", { productId: created.id });
        return { ...created, photos };
    },
    async update(params) {
        const { productId, requesterUserId, requesterRole, patch } = params;
        logger_1.default.info("productsService.update called", { productId, requesterUserId, requesterRole });
        const existing = await products_repository_1.productsRepository.findById(productId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Product not found", "NOT_FOUND");
        const updated = await products_repository_1.productsRepository.update(productId, patch);
        logger_1.default.info("productsService.update success", { productId: updated.id });
        return updated;
    },
    async delete(params) {
        const { productId, requesterUserId, requesterRole } = params;
        logger_1.default.info("productsService.delete called", { productId, requesterUserId, requesterRole });
        const existing = await products_repository_1.productsRepository.findById(productId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Product not found", "NOT_FOUND");
        await products_repository_1.productsRepository.delete(productId);
        logger_1.default.info("productsService.delete success", { productId });
    },
    // ─── Photos ──────────────────────────────────────────────────────────────────
    async uploadPhotos(params) {
        const { productId, requesterUserId, files } = params;
        logger_1.default.info("productsService.uploadPhotos called", { productId, requesterUserId });
        const existing = await products_repository_1.productsRepository.findById(productId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Product not found", "NOT_FOUND");
        if (files.length === 0)
            throw new error_middleware_1.AppError(400, "No photos uploaded", "VALIDATION_ERROR");
        const maxOrder = await products_repository_1.productPhotosRepository.getMaxSortOrder(productId);
        const photos = await products_repository_1.productPhotosRepository.insertMany(productId, files, maxOrder + 1);
        logger_1.default.info("productsService.uploadPhotos success", { productId, count: photos.length });
        return photos;
    },
    async reorderPhotos(params) {
        const { productId, requesterUserId, body } = params;
        logger_1.default.info("productsService.reorderPhotos called", { productId, requesterUserId });
        const existing = await products_repository_1.productsRepository.findById(productId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Product not found", "NOT_FOUND");
        const updates = body.photo_ids.map((id, i) => ({ id, sort_order: i }));
        await products_repository_1.productPhotosRepository.reorder(updates);
        logger_1.default.info("productsService.reorderPhotos success", { productId });
    },
    async deletePhoto(params) {
        const { productId, photoId, requesterUserId } = params;
        logger_1.default.info("productsService.deletePhoto called", { productId, photoId, requesterUserId });
        const photo = await products_repository_1.productPhotosRepository.findById(photoId);
        if (!photo || photo.product_id !== productId) {
            throw new error_middleware_1.AppError(404, "Photo not found", "NOT_FOUND");
        }
        await products_repository_1.productPhotosRepository.delete(photoId);
        logger_1.default.info("productsService.deletePhoto success", { photoId });
    },
};
// ─── Brands Service ───────────────────────────────────────────────────────────
exports.brandsService = {
    async list() {
        return products_repository_1.brandsRepository.list();
    },
    async getById(id) {
        const brand = await products_repository_1.brandsRepository.findById(id);
        if (!brand)
            throw new error_middleware_1.AppError(404, "Brand not found", "NOT_FOUND");
        return brand;
    },
    async create(params) {
        const { requesterUserId, requesterRole, body } = params;
        logger_1.default.info("brandsService.create called", { requesterUserId, requesterRole });
        const existing = await products_repository_1.brandsRepository.findByName(body.name);
        if (existing)
            throw new error_middleware_1.AppError(409, "A brand with this name already exists", "CONFLICT");
        const created = await products_repository_1.brandsRepository.create(body);
        logger_1.default.info("brandsService.create success", { brandId: created.id });
        return created;
    },
    async update(params) {
        const { brandId, requesterUserId, requesterRole, patch } = params;
        logger_1.default.info("brandsService.update called", { brandId, requesterUserId, requesterRole });
        const existing = await products_repository_1.brandsRepository.findById(brandId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Brand not found", "NOT_FOUND");
        if (patch.name) {
            const nameConflict = await products_repository_1.brandsRepository.findByName(patch.name);
            if (nameConflict && nameConflict.id !== brandId) {
                throw new error_middleware_1.AppError(409, "A brand with this name already exists", "CONFLICT");
            }
        }
        const updated = await products_repository_1.brandsRepository.update(brandId, patch);
        logger_1.default.info("brandsService.update success", { brandId: updated.id });
        return updated;
    },
    async delete(params) {
        const { brandId, requesterUserId, requesterRole } = params;
        logger_1.default.info("brandsService.delete called", { brandId, requesterUserId, requesterRole });
        const existing = await products_repository_1.brandsRepository.findById(brandId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Brand not found", "NOT_FOUND");
        await products_repository_1.brandsRepository.delete(brandId);
        logger_1.default.info("brandsService.delete success", { brandId });
    },
};
//# sourceMappingURL=products.service.js.map