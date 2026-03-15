"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketplaceController = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const marketplace_service_1 = require("./marketplace.service");
const getSalonId = (req) => {
    const id = String(req.headers["x-salon-id"] ?? "").trim();
    if (!id)
        throw new error_middleware_1.AppError(400, "x-salon-id header is required", "VALIDATION_ERROR");
    return id;
};
exports.marketplaceController = {
    // ── Full Profile ─────────────────────────────────────────────────────────────
    async getProfile(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.getProfile(getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Marketplace profile fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    // ── Essentials ───────────────────────────────────────────────────────────────
    async upsertEssentials(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.upsertEssentials(getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Venue essentials saved");
        }
        catch (err) {
            return next(err);
        }
    },
    // ── About ────────────────────────────────────────────────────────────────────
    async upsertAbout(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.upsertAbout(getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "About section saved");
        }
        catch (err) {
            return next(err);
        }
    },
    // ── Location ─────────────────────────────────────────────────────────────────
    async getLocation(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.getLocation(getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Location fetched");
        }
        catch (err) {
            return next(err);
        }
    },
    async upsertLocation(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.upsertLocation(getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Location saved");
        }
        catch (err) {
            return next(err);
        }
    },
    // ── Working Hours ────────────────────────────────────────────────────────────
    async getWorkingHours(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.getWorkingHours(getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Opening hours fetched");
        }
        catch (err) {
            return next(err);
        }
    },
    async upsertWorkingHours(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.upsertWorkingHours(getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Opening hours saved");
        }
        catch (err) {
            return next(err);
        }
    },
    // ── Images ───────────────────────────────────────────────────────────────────
    async getImages(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.getImages(getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Images fetched");
        }
        catch (err) {
            return next(err);
        }
    },
    async addImage(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.addImage(getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 201, data, "Image added");
        }
        catch (err) {
            return next(err);
        }
    },
    async setCoverImage(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.setCoverImage(getSalonId(req), String(req.params.imageId));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Cover image updated");
        }
        catch (err) {
            return next(err);
        }
    },
    async reorderImages(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.reorderImages(getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Images reordered");
        }
        catch (err) {
            return next(err);
        }
    },
    async deleteImage(req, res, next) {
        try {
            await marketplace_service_1.marketplaceService.deleteImage(getSalonId(req), String(req.params.imageId));
            return (0, response_util_1.sendSuccess)(res, 200, null, "Image deleted");
        }
        catch (err) {
            return next(err);
        }
    },
    // ── Features ─────────────────────────────────────────────────────────────────
    async getFeatures(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.getFeatures(getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Amenities and highlights fetched");
        }
        catch (err) {
            return next(err);
        }
    },
    async upsertFeatures(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.upsertFeatures(getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Amenities and highlights saved");
        }
        catch (err) {
            return next(err);
        }
    },
    // ── Publish ──────────────────────────────────────────────────────────────────
    async publish(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.publish(getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Profile published successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async unpublish(req, res, next) {
        try {
            const data = await marketplace_service_1.marketplaceService.unpublish(getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Profile unpublished");
        }
        catch (err) {
            return next(err);
        }
    },
};
//# sourceMappingURL=marketplace.controller.js.map