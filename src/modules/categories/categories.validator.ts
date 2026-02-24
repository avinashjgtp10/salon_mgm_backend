import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v: unknown) => v === undefined || typeof v === "string";
const isOptionalNumber = (v: unknown) => v === undefined || typeof v === "number";

export const validateCreateCategory = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (!isNonEmptyString(b.name)) {
            throw new AppError(400, "name is required", "VALIDATION_ERROR");
        }

        const optionalStringFields = ["description"];
        for (const f of optionalStringFields) {
            if (!isOptionalString(b[f])) {
                throw new AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }

        if (!isOptionalNumber(b.display_order)) {
            throw new AppError(400, "display_order must be a number", "VALIDATION_ERROR");
        }

        if (b.is_active !== undefined && typeof b.is_active !== "boolean") {
            throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateCategory = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (b.name !== undefined && !isNonEmptyString(b.name)) {
            throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
        }

        const optionalStringFields = ["description"];
        for (const f of optionalStringFields) {
            if (!isOptionalString(b[f])) {
                throw new AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }

        if (!isOptionalNumber(b.display_order)) {
            throw new AppError(400, "display_order must be a number", "VALIDATION_ERROR");
        }

        if (b.is_active !== undefined && typeof b.is_active !== "boolean") {
            throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};
