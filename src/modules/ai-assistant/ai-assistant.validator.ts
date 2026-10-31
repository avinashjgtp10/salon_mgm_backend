import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

export const validateChat = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body ?? {};
        if (typeof b.message !== "string" || !b.message.trim()) {
            throw new AppError(400, "message is required", "VALIDATION_ERROR");
        }
        if (b.message.length > 2000) {
            throw new AppError(400, "message is too long", "VALIDATION_ERROR");
        }
        if (b.history !== undefined && !Array.isArray(b.history)) {
            throw new AppError(400, "history must be an array", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateCampaign = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body ?? {};
        if (typeof b.brief !== "string" || b.brief.trim().length < 8) {
            throw new AppError(400, "Describe the campaign in a few words, e.g. 'Diwali offer for Hair Spa at ₹999'.", "VALIDATION_ERROR");
        }
        if (b.brief.length > 500) {
            throw new AppError(400, "brief is too long (max 500 characters)", "VALIDATION_ERROR");
        }
        if (b.format !== undefined && b.format !== "post" && b.format !== "story") {
            throw new AppError(400, "format must be 'post' or 'story'", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) {
        return next(err);
    }
};
