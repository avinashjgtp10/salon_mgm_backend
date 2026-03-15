"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketplaceService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const marketplace_repository_1 = require("./marketplace.repository");
const MAX_IMAGES = 10;
// ─── Helper: ensure profile exists ───────────────────────────────────────────
async function _ensureProfile(salonId) {
    const profile = await marketplace_repository_1.marketplaceProfileRepo.findBySalonId(salonId);
    if (!profile)
        throw new error_middleware_1.AppError(404, "Marketplace profile not found. Save venue essentials first.", "NOT_FOUND");
    return profile;
}
// ─── Helper: group flat working hour rows into day objects ────────────────────
function _groupHours(rows) {
    const map = new Map();
    for (const r of rows) {
        if (!map.has(r.day_of_week)) {
            map.set(r.day_of_week, { day_of_week: r.day_of_week, is_open: r.is_open, slots: [] });
        }
        const day = map.get(r.day_of_week);
        if (r.is_open && r.open_time && r.close_time) {
            day.slots.push({ open_time: r.open_time, close_time: r.close_time });
        }
    }
    return Array.from(map.values()).sort((a, b) => a.day_of_week - b.day_of_week);
}
// ─── Full Profile ─────────────────────────────────────────────────────────────
exports.marketplaceService = {
    async getProfile(salonId) {
        const profile = await _ensureProfile(salonId);
        const [location, hourRows, images, featureRows] = await Promise.all([
            marketplace_repository_1.marketplaceLocationRepo.findByProfileId(profile.id),
            marketplace_repository_1.marketplaceWorkingHoursRepo.findByProfileId(profile.id),
            marketplace_repository_1.marketplaceImagesRepo.findByProfileId(profile.id),
            marketplace_repository_1.marketplaceFeaturesRepo.findByProfileId(profile.id),
        ]);
        return {
            ...profile,
            location,
            working_hours: _groupHours(hourRows),
            images,
            amenities: featureRows.filter((f) => f.feature_type === "amenity").map((f) => f.feature_key),
            highlights: featureRows.filter((f) => f.feature_type === "highlight").map((f) => f.feature_key),
            values: featureRows.filter((f) => f.feature_type === "value").map((f) => f.feature_key),
        };
    },
    // ── Essentials ──────────────────────────────────────────────────────────────
    async upsertEssentials(salonId, data) {
        logger_1.default.info("marketplace.upsertEssentials", { salonId });
        return marketplace_repository_1.marketplaceProfileRepo.upsertEssentials(salonId, data);
    },
    // ── About ───────────────────────────────────────────────────────────────────
    async upsertAbout(salonId, data) {
        logger_1.default.info("marketplace.upsertAbout", { salonId });
        await _ensureProfile(salonId);
        return marketplace_repository_1.marketplaceProfileRepo.upsertAbout(salonId, data);
    },
    // ── Location ────────────────────────────────────────────────────────────────
    async getLocation(salonId) {
        const profile = await _ensureProfile(salonId);
        return marketplace_repository_1.marketplaceLocationRepo.findByProfileId(profile.id);
    },
    async upsertLocation(salonId, data) {
        logger_1.default.info("marketplace.upsertLocation", { salonId });
        const profile = await _ensureProfile(salonId);
        return marketplace_repository_1.marketplaceLocationRepo.upsert(profile.id, data);
    },
    // ── Working Hours ───────────────────────────────────────────────────────────
    async getWorkingHours(salonId) {
        const profile = await _ensureProfile(salonId);
        const rows = await marketplace_repository_1.marketplaceWorkingHoursRepo.findByProfileId(profile.id);
        return _groupHours(rows);
    },
    async upsertWorkingHours(salonId, data) {
        logger_1.default.info("marketplace.upsertWorkingHours", { salonId });
        const profile = await _ensureProfile(salonId);
        const rows = await marketplace_repository_1.marketplaceWorkingHoursRepo.upsertBulk(profile.id, data);
        return _groupHours(rows);
    },
    // ── Images ──────────────────────────────────────────────────────────────────
    async getImages(salonId) {
        const profile = await _ensureProfile(salonId);
        return marketplace_repository_1.marketplaceImagesRepo.findByProfileId(profile.id);
    },
    async addImage(salonId, data) {
        logger_1.default.info("marketplace.addImage", { salonId });
        const profile = await _ensureProfile(salonId);
        const count = await marketplace_repository_1.marketplaceImagesRepo.count(profile.id);
        if (count >= MAX_IMAGES)
            throw new error_middleware_1.AppError(400, `Maximum of ${MAX_IMAGES} images allowed`, "LIMIT_EXCEEDED");
        return marketplace_repository_1.marketplaceImagesRepo.add(profile.id, data);
    },
    async setCoverImage(salonId, imageId) {
        logger_1.default.info("marketplace.setCoverImage", { salonId, imageId });
        const profile = await _ensureProfile(salonId);
        const updated = await marketplace_repository_1.marketplaceImagesRepo.setCover(imageId, profile.id);
        if (!updated)
            throw new error_middleware_1.AppError(404, "Image not found", "NOT_FOUND");
        return updated;
    },
    async reorderImages(salonId, data) {
        logger_1.default.info("marketplace.reorderImages", { salonId });
        const profile = await _ensureProfile(salonId);
        await marketplace_repository_1.marketplaceImagesRepo.reorder(profile.id, data);
        return marketplace_repository_1.marketplaceImagesRepo.findByProfileId(profile.id);
    },
    async deleteImage(salonId, imageId) {
        logger_1.default.info("marketplace.deleteImage", { salonId, imageId });
        const profile = await _ensureProfile(salonId);
        const deleted = await marketplace_repository_1.marketplaceImagesRepo.delete(imageId, profile.id);
        if (!deleted)
            throw new error_middleware_1.AppError(404, "Image not found", "NOT_FOUND");
    },
    // ── Features ────────────────────────────────────────────────────────────────
    async getFeatures(salonId) {
        const profile = await _ensureProfile(salonId);
        const rows = await marketplace_repository_1.marketplaceFeaturesRepo.findByProfileId(profile.id);
        return {
            amenities: rows.filter((f) => f.feature_type === "amenity").map((f) => f.feature_key),
            highlights: rows.filter((f) => f.feature_type === "highlight").map((f) => f.feature_key),
            values: rows.filter((f) => f.feature_type === "value").map((f) => f.feature_key),
        };
    },
    async upsertFeatures(salonId, data) {
        logger_1.default.info("marketplace.upsertFeatures", { salonId });
        const profile = await _ensureProfile(salonId);
        await marketplace_repository_1.marketplaceFeaturesRepo.upsert(profile.id, data);
        return this.getFeatures(salonId);
    },
    // ── Publish ─────────────────────────────────────────────────────────────────
    async publish(salonId) {
        logger_1.default.info("marketplace.publish", { salonId });
        await _ensureProfile(salonId);
        const updated = await marketplace_repository_1.marketplaceProfileRepo.setPublished(salonId, true);
        if (!updated)
            throw new error_middleware_1.AppError(500, "Failed to publish", "INTERNAL_ERROR");
        return updated;
    },
    async unpublish(salonId) {
        logger_1.default.info("marketplace.unpublish", { salonId });
        await _ensureProfile(salonId);
        const updated = await marketplace_repository_1.marketplaceProfileRepo.setPublished(salonId, false);
        if (!updated)
            throw new error_middleware_1.AppError(500, "Failed to unpublish", "INTERNAL_ERROR");
        return updated;
    },
};
//# sourceMappingURL=marketplace.service.js.map