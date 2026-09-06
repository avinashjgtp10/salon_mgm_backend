import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { marketplaceService } from "./marketplace.service";
import { uploadAvatarToS3 } from "../utils/avatar.upload";
import {
    UpsertEssentialsBody, UpsertAboutBody, UpsertLocationBody,
    UpsertWorkingHoursBody, AddImageBody, ReorderImagesBody, UpsertFeaturesBody,
    UpsertBookingPolicyBody,
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
            const data = await marketplaceService.getProfile(await getSalonId(req));
            return sendSuccess(res, 200, data, "Marketplace profile fetched successfully");
        } catch (err) { return next(err); }
    },

    // ── Essentials ───────────────────────────────────────────────────────────────
    async upsertEssentials(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertEssentials(await getSalonId(req), req.body as UpsertEssentialsBody);
            return sendSuccess(res, 200, data, "Venue essentials saved");
        } catch (err) { return next(err); }
    },

    // ── About ────────────────────────────────────────────────────────────────────
    async upsertAbout(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertAbout(await getSalonId(req), req.body as UpsertAboutBody);
            return sendSuccess(res, 200, data, "About section saved");
        } catch (err) { return next(err); }
    },

    // ── Booking Policy ───────────────────────────────────────────────────────────
    async upsertBookingPolicy(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertBookingPolicy(await getSalonId(req), req.body as UpsertBookingPolicyBody);
            return sendSuccess(res, 200, data, "Booking policy saved");
        } catch (err) { return next(err); }
    },

    // ── Location ─────────────────────────────────────────────────────────────────
    async getLocation(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.getLocation(await getSalonId(req));
            return sendSuccess(res, 200, data, "Location fetched");
        } catch (err) { return next(err); }
    },

    async upsertLocation(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertLocation(await getSalonId(req), req.body as UpsertLocationBody);
            return sendSuccess(res, 200, data, "Location saved");
        } catch (err) { return next(err); }
    },

    // ── Working Hours ────────────────────────────────────────────────────────────
    async getWorkingHours(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.getWorkingHours(await getSalonId(req));
            return sendSuccess(res, 200, data, "Opening hours fetched");
        } catch (err) { return next(err); }
    },

    async upsertWorkingHours(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertWorkingHours(await getSalonId(req), req.body as UpsertWorkingHoursBody);
            return sendSuccess(res, 200, data, "Opening hours saved");
        } catch (err) { return next(err); }
    },

    // ── Images ───────────────────────────────────────────────────────────────────
    async getImages(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.getImages(await getSalonId(req));
            return sendSuccess(res, 200, data, "Images fetched");
        } catch (err) { return next(err); }
    },

    async addImage(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            let imageUrl: string = (req.body as AddImageBody)?.image_url;
            const file = (req as any).file as Express.Multer.File | undefined;
            const salonId = await getSalonId(req);
            if (file) {
                imageUrl = await uploadAvatarToS3(file.path, `${salonId}-gallery-${Date.now()}`, file.mimetype, "gallery");
            }
            if (!imageUrl) throw new AppError(400, "No image provided", "VALIDATION_ERROR");
            const data = await marketplaceService.addImage(salonId, { image_url: imageUrl });
            return sendSuccess(res, 201, data, "Image added");
        } catch (err) { return next(err); }
    },

    async setCoverImage(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.setCoverImage(await getSalonId(req), String(req.params.imageId));
            return sendSuccess(res, 200, data, "Cover image updated");
        } catch (err) { return next(err); }
    },

    async reorderImages(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.reorderImages(await getSalonId(req), req.body as ReorderImagesBody);
            return sendSuccess(res, 200, data, "Images reordered");
        } catch (err) { return next(err); }
    },

    async deleteImage(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await marketplaceService.deleteImage(await getSalonId(req), String(req.params.imageId));
            return sendSuccess(res, 200, null, "Image deleted");
        } catch (err) { return next(err); }
    },

    // ── Features ─────────────────────────────────────────────────────────────────
    async getFeatures(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.getFeatures(await getSalonId(req));
            return sendSuccess(res, 200, data, "Amenities and highlights fetched");
        } catch (err) { return next(err); }
    },

    async upsertFeatures(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.upsertFeatures(await getSalonId(req), req.body as UpsertFeaturesBody);
            return sendSuccess(res, 200, data, "Amenities and highlights saved");
        } catch (err) { return next(err); }
    },

    // ── Logo & Cover ─────────────────────────────────────────────────────────────
    async uploadLogo(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file) throw new AppError(400, "No image file provided", "VALIDATION_ERROR");
            const salonId = await getSalonId(req);
            const logoUrl = await uploadAvatarToS3(file.path, `${salonId}-logo-${Date.now()}`, file.mimetype, "logos");
            const data = await marketplaceService.uploadLogo(salonId, logoUrl);
            return sendSuccess(res, 200, data, "Logo uploaded");
        } catch (err) { return next(err); }
    },

    async uploadCover(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file) throw new AppError(400, "No image file provided", "VALIDATION_ERROR");
            const salonId = await getSalonId(req);
            const coverUrl = await uploadAvatarToS3(file.path, `${salonId}-cover-${Date.now()}`, file.mimetype, "covers");
            const data = await marketplaceService.uploadCover(salonId, coverUrl);
            return sendSuccess(res, 200, data, "Cover photo uploaded");
        } catch (err) { return next(err); }
    },

    // ── Publish ──────────────────────────────────────────────────────────────────
    async publish(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.publish(await getSalonId(req));
            return sendSuccess(res, 200, data, "Profile published successfully");
        } catch (err) { return next(err); }
    },

    async unpublish(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await marketplaceService.unpublish(await getSalonId(req));
            return sendSuccess(res, 200, data, "Profile unpublished");
        } catch (err) { return next(err); }
    },
};
