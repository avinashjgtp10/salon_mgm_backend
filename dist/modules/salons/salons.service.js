"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.salonsService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const salons_repository_1 = require("./salons.repository");
const slugify = (text) => text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
exports.salonsService = {
    async create(ownerId, body) {
        logger_1.default.info("salonsService.create called", { ownerId });
        const existing = await salons_repository_1.salonsRepository.findByOwnerId(ownerId);
        if (existing) {
            throw new error_middleware_1.AppError(409, "Salon already exists for this owner", "SALON_EXISTS");
        }
        let slug = body.slug?.trim();
        if (!slug)
            slug = slugify(body.business_name);
        slug = slugify(slug);
        // ensure unique slug
        let finalSlug = slug;
        let i = 1;
        while (true) {
            const found = await salons_repository_1.salonsRepository.findBySlug(finalSlug);
            if (!found)
                break;
            i += 1;
            finalSlug = `${slug}-${i}`;
        }
        try {
            const created = await salons_repository_1.salonsRepository.create(ownerId, { ...body, slug: finalSlug });
            logger_1.default.info("salonsService.create success", {
                ownerId,
                salonId: created.id,
                slug: created.slug,
            });
            return created;
        }
        catch (e) {
            if (e?.code === "23505") {
                throw new error_middleware_1.AppError(409, "Slug already exists", "SLUG_EXISTS");
            }
            throw e;
        }
    },
    async mySalon(ownerId) {
        const salon = await salons_repository_1.salonsRepository.findByOwnerId(ownerId);
        if (!salon)
            throw new error_middleware_1.AppError(404, "Salon not found", "NOT_FOUND");
        return salon;
    },
    async getById(id) {
        const salon = await salons_repository_1.salonsRepository.findById(id);
        if (!salon)
            throw new error_middleware_1.AppError(404, "Salon not found", "NOT_FOUND");
        return salon;
    },
    async listAll() {
        return salons_repository_1.salonsRepository.listAll();
    },
    async updateByOwnerOrAdmin(params) {
        const { salonId, requesterUserId, requesterRole, patch } = params;
        logger_1.default.info("salonsService.updateByOwnerOrAdmin called", {
            salonId,
            requesterUserId,
            requesterRole,
        });
        const salon = await salons_repository_1.salonsRepository.findById(salonId);
        if (!salon)
            throw new error_middleware_1.AppError(404, "Salon not found", "NOT_FOUND");
        const isAdmin = requesterRole === "admin";
        const isOwner = salon.owner_id === requesterUserId;
        if (!isAdmin && !isOwner) {
            throw new error_middleware_1.AppError(403, "Forbidden", "FORBIDDEN");
        }
        if (patch.slug)
            patch.slug = slugify(patch.slug);
        try {
            const updated = await salons_repository_1.salonsRepository.update(salonId, patch);
            logger_1.default.info("salonsService.updateByOwnerOrAdmin success", {
                salonId: updated.id,
                slug: updated.slug,
            });
            return updated;
        }
        catch (e) {
            if (e?.code === "23505") {
                throw new error_middleware_1.AppError(409, "Slug already exists", "SLUG_EXISTS");
            }
            throw e;
        }
    },
};
//# sourceMappingURL=salons.service.js.map