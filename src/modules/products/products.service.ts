import logger from "../../config/logger";
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
        filters: ProductListFilters;
    }) {
        const { requesterUserId, requesterRole, filters } = params;
        logger.info("productsService.list called", { requesterUserId, requesterRole, filters });
        return productsRepository.list(filters);
    },

    async getById(id: string): Promise<Product & { photos: ProductPhoto[] }> {
        const product = await productsRepository.findById(id);
        if (!product) throw new AppError(404, "Product not found", "NOT_FOUND");
        const photos = await productPhotosRepository.findByProductId(id);
        return { ...product, photos };
    },

    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateProductBody;
        files: { url: string; filename: string }[];
    }): Promise<Product & { photos: ProductPhoto[] }> {
        const { requesterUserId, requesterRole, body, files } = params;
        logger.info("productsService.create called", { requesterUserId, requesterRole });
        const created = await productsRepository.create(body);
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
        patch: UpdateProductBody;
    }): Promise<Product> {
        const { productId, requesterUserId, requesterRole, patch } = params;
        logger.info("productsService.update called", { productId, requesterUserId, requesterRole });
        const existing = await productsRepository.findById(productId);
        if (!existing) throw new AppError(404, "Product not found", "NOT_FOUND");
        const updated = await productsRepository.update(productId, patch);
        logger.info("productsService.update success", { productId: updated.id });
        return updated;
    },

    async delete(params: {
        productId: string;
        requesterUserId: string;
        requesterRole?: string;
    }): Promise<void> {
        const { productId, requesterUserId, requesterRole } = params;
        logger.info("productsService.delete called", { productId, requesterUserId, requesterRole });
        const existing = await productsRepository.findById(productId);
        if (!existing) throw new AppError(404, "Product not found", "NOT_FOUND");
        await productsRepository.delete(productId);
        logger.info("productsService.delete success", { productId });
    },

    // ─── Photos ──────────────────────────────────────────────────────────────────

    async uploadPhotos(params: {
        productId: string;
        requesterUserId: string;
        files: { url: string; filename: string }[];
    }): Promise<ProductPhoto[]> {
        const { productId, requesterUserId, files } = params;
        logger.info("productsService.uploadPhotos called", { productId, requesterUserId });
        const existing = await productsRepository.findById(productId);
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
        body: ReorderPhotosBody;
    }): Promise<void> {
        const { productId, requesterUserId, body } = params;
        logger.info("productsService.reorderPhotos called", { productId, requesterUserId });
        const existing = await productsRepository.findById(productId);
        if (!existing) throw new AppError(404, "Product not found", "NOT_FOUND");
        const updates = body.photo_ids.map((id, i) => ({ id, sort_order: i }));
        await productPhotosRepository.reorder(updates);
        logger.info("productsService.reorderPhotos success", { productId });
    },

    async deletePhoto(params: {
        productId: string;
        photoId: string;
        requesterUserId: string;
    }): Promise<void> {
        const { productId, photoId, requesterUserId } = params;
        logger.info("productsService.deletePhoto called", { productId, photoId, requesterUserId });
        const photo = await productPhotosRepository.findById(photoId);
        if (!photo || photo.product_id !== productId) {
            throw new AppError(404, "Photo not found", "NOT_FOUND");
        }
        await productPhotosRepository.delete(photoId);
        logger.info("productsService.deletePhoto success", { photoId });
    },
};

// ─── Brands Service ───────────────────────────────────────────────────────────

export const brandsService = {
    async list(): Promise<Brand[]> {
        return brandsRepository.list();
    },

    async getById(id: string): Promise<Brand> {
        const brand = await brandsRepository.findById(id);
        if (!brand) throw new AppError(404, "Brand not found", "NOT_FOUND");
        return brand;
    },

    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateBrandBody;
    }): Promise<Brand> {
        const { requesterUserId, requesterRole, body } = params;
        logger.info("brandsService.create called", { requesterUserId, requesterRole });
        const existing = await brandsRepository.findByName(body.name);
        if (existing) throw new AppError(409, "A brand with this name already exists", "CONFLICT");
        const created = await brandsRepository.create(body);
        logger.info("brandsService.create success", { brandId: created.id });
        return created;
    },

    async update(params: {
        brandId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateBrandBody;
    }): Promise<Brand> {
        const { brandId, requesterUserId, requesterRole, patch } = params;
        logger.info("brandsService.update called", { brandId, requesterUserId, requesterRole });
        const existing = await brandsRepository.findById(brandId);
        if (!existing) throw new AppError(404, "Brand not found", "NOT_FOUND");
        if (patch.name) {
            const nameConflict = await brandsRepository.findByName(patch.name);
            if (nameConflict && nameConflict.id !== brandId) {
                throw new AppError(409, "A brand with this name already exists", "CONFLICT");
            }
        }
        const updated = await brandsRepository.update(brandId, patch);
        logger.info("brandsService.update success", { brandId: updated.id });
        return updated;
    },

    async delete(params: {
        brandId: string;
        requesterUserId: string;
        requesterRole?: string;
    }): Promise<void> {
        const { brandId, requesterUserId, requesterRole } = params;
        logger.info("brandsService.delete called", { brandId, requesterUserId, requesterRole });
        const existing = await brandsRepository.findById(brandId);
        if (!existing) throw new AppError(404, "Brand not found", "NOT_FOUND");
        await brandsRepository.delete(brandId);
        logger.info("brandsService.delete success", { brandId });
    },
};
