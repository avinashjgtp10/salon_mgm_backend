import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { marketplaceService } from "./marketplace.service";
import {
    UpsertEssentialsBody, UpsertAboutBody, UpsertLocationBody,
    UpsertWorkingHoursBody, AddImageBody, ReorderImagesBody, UpsertFeaturesBody,
} from "./marketplace.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
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
            let imageUrl: string = (req.body as AddImageBody)?.image_url;
            const file = (req as any).file as Express.Multer.File | undefined;
            if (file) {
                // Use APP_BASE_URL in production; fall back to relative path for dev proxy
                const base = process.env.APP_BASE_URL || "";
                imageUrl = `${base}/uploads/${file.filename}`;
            }
            if (!imageUrl) throw new AppError(400, "No image provided", "VALIDATION_ERROR");
            const data = await marketplaceService.addImage(getSalonId(req), { image_url: imageUrl });
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

    // ── Logo & Cover ─────────────────────────────────────────────────────────────
    async uploadLogo(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file) throw new AppError(400, "No image file provided", "VALIDATION_ERROR");
            const base = process.env.APP_BASE_URL || "";
            const logoUrl = `${base}/uploads/${file.filename}`;
            const data = await marketplaceService.uploadLogo(getSalonId(req), logoUrl);
            return sendSuccess(res, 200, data, "Logo uploaded");
        } catch (err) { return next(err); }
    },

    async uploadCover(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file) throw new AppError(400, "No image file provided", "VALIDATION_ERROR");
            const base = process.env.APP_BASE_URL || "";
            const coverUrl = `${base}/uploads/${file.filename}`;
            const data = await marketplaceService.uploadCover(getSalonId(req), coverUrl);
            return sendSuccess(res, 200, data, "Cover photo uploaded");
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