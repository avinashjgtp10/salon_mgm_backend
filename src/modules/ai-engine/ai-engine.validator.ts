import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export const validateChat = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (!isNonEmptyString(b.phone)) {
            throw new AppError(400, "phone is required", "VALIDATION_ERROR");
        }
        if (!isNonEmptyString(b.message)) {
            throw new AppError(400, "message is required", "VALIDATION_ERROR");
        }
        if (b.message.length > 2000) {
            throw new AppError(400, "message is too long", "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};
