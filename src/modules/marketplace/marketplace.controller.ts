import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { marketplaceService } from "./marketplace.service";
import {
    UpsertEssentialsBody, UpsertAboutBody, UpsertLocationBody,
    UpsertWorkingHoursBody, AddImageBody, ReorderImagesBody, UpsertFeaturesBody,
} from "./marketplace.types";

type AuthRequest = Request & { user?: { userId: string; role?: string } };

const getSalonId = (req: Request): string => {
    const id = String(req.headers["x-salon-id"] ?? "").trim();
    if (!id) throw new AppError(400, "x-salon-id header is required", "VALIDATION_ERROR");
    return id;
};

export const marketplaceController = {

    // ── Full Profile ─────────────────────────────────────────────────────────────
    async getProfile(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.getProfile(getSalonId(req));
            return sendSuccess(res, 200, data, "Marketplace profile fetched successfully");
        } catch (err) { return next(err); }
    },

    // ── Essentials ───────────────────────────────────────────────────────────────
    async upsertEssentials(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertEssentials(getSalonId(req), req.body as UpsertEssentialsBody);
            return sendSuccess(res, 200, data, "Venue essentials saved");
        } catch (err) { return next(err); }
    },

    // ── About ────────────────────────────────────────────────────────────────────
    async upsertAbout(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertAbout(getSalonId(req), req.body as UpsertAboutBody);
            return sendSuccess(res, 200, data, "About section saved");
        } catch (err) { return next(err); }
    },

    // ── Location ─────────────────────────────────────────────────────────────────
    async getLocation(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.getLocation(getSalonId(req));
            return sendSuccess(res, 200, data, "Location fetched");
        } catch (err) { return next(err); }
    },

    async upsertLocation(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertLocation(getSalonId(req), req.body as UpsertLocationBody);
            return sendSuccess(res, 200, data, "Location saved");
        } catch (err) { return next(err); }
    },

    // ── Working Hours ────────────────────────────────────────────────────────────
    async getWorkingHours(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.getWorkingHours(getSalonId(req));
            return sendSuccess(res, 200, data, "Opening hours fetched");
        } catch (err) { return next(err); }
    },

    async upsertWorkingHours(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertWorkingHours(getSalonId(req), req.body as UpsertWorkingHoursBody);
            return sendSuccess(res, 200, data, "Opening hours saved");
        } catch (err) { return next(err); }
    },

    // ── Images ───────────────────────────────────────────────────────────────────
    async getImages(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.getImages(getSalonId(req));
            return sendSuccess(res, 200, data, "Images fetched");
        } catch (err) { return next(err); }
    },

    async addImage(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.addImage(getSalonId(req), req.body as AddImageBody);
            return sendSuccess(res, 201, data, "Image added");
        } catch (err) { return next(err); }
    },

    async setCoverImage(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.setCoverImage(getSalonId(req), String(req.params.imageId));
            return sendSuccess(res, 200, data, "Cover image updated");
        } catch (err) { return next(err); }
    },

    async reorderImages(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.reorderImages(getSalonId(req), req.body as ReorderImagesBody);
            return sendSuccess(res, 200, data, "Images reordered");
        } catch (err) { return next(err); }
    },

    async deleteImage(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await marketplaceService.deleteImage(getSalonId(req), String(req.params.imageId));
            return sendSuccess(res, 200, null, "Image deleted");
        } catch (err) { return next(err); }
    },

    // ── Features ─────────────────────────────────────────────────────────────────
    async getFeatures(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.getFeatures(getSalonId(req));
            return sendSuccess(res, 200, data, "Amenities and highlights fetched");
        } catch (err) { return next(err); }
    },

    async upsertFeatures(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertFeatures(getSalonId(req), req.body as UpsertFeaturesBody);
            return sendSuccess(res, 200, data, "Amenities and highlights saved");
        } catch (err) { return next(err); }
    },

    // ── Publish ──────────────────────────────────────────────────────────────────
    async publish(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.publish(getSalonId(req));
            return sendSuccess(res, 200, data, "Profile published successfully");
        } catch (err) { return next(err); }
    },

    async unpublish(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.unpublish(getSalonId(req));
            return sendSuccess(res, 200, data, "Profile unpublished");
        } catch (err) { return next(err); }
    },
};