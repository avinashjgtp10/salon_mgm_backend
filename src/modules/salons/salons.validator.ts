import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v: unknown) => v === undefined || typeof v === "string";

// 2-digit state code + 10-char PAN + 1-digit entity code + "Z" + 1 checksum char.
const GSTIN_FORMAT_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_FORMAT_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const validateTaxFields = (b: Record<string, unknown>) => {
    if (b.gst_number !== undefined && b.gst_number !== "" && !GSTIN_FORMAT_RE.test(String(b.gst_number).toUpperCase())) {
        throw new AppError(400, "gst_number must be a valid 15-character GSTIN (e.g. 22AAAAA0000A1Z5)", "VALIDATION_ERROR");
    }
    if (b.pan_number !== undefined && b.pan_number !== "" && !PAN_FORMAT_RE.test(String(b.pan_number).toUpperCase())) {
        throw new AppError(400, "pan_number must be a valid 10-character PAN (e.g. AAAAA0000A)", "VALIDATION_ERROR");
    }
};

export const validateCreateSalon = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (!isNonEmptyString(b.business_name)) {
            throw new AppError(400, "business_name is required", "VALIDATION_ERROR");
        }

        const optionalFields = [
            "business_type",
            "slug",
            "description",
            "logo_url",
            "banner_url",
            "email",
            "phone",
            "website_url",
            "google_review_url",
            "gst_number",
            "pan_number",
            "currency",
        ];

        for (const f of optionalFields) {
            if (!isOptionalString(b[f])) {
                throw new AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }

        if (b.currency !== undefined && b.currency !== "" && !/^[A-Z]{3}$/.test(b.currency)) {
            throw new AppError(400, "currency must be a 3-letter ISO 4217 code (e.g. INR, USD)", "VALIDATION_ERROR");
        }

        validateTaxFields(b);

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateSalon = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        const optionalFields = [
            "business_name",
            "business_type",
            "slug",
            "description",
            "logo_url",
            "banner_url",
            "email",
            "phone",
            "website_url",
            "google_review_url",
            "gst_number",
            "pan_number",
            "currency",
        ];

        for (const f of optionalFields) {
            if (!isOptionalString(b[f])) {
                throw new AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }

        if (b.currency !== undefined && b.currency !== "" && !/^[A-Z]{3}$/.test(b.currency)) {
            throw new AppError(400, "currency must be a 3-letter ISO 4217 code (e.g. INR, USD)", "VALIDATION_ERROR");
        }

        if (b.is_active !== undefined && typeof b.is_active !== "boolean") {
            throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");
        }

        if (b.onboarding_completed !== undefined && typeof b.onboarding_completed !== "boolean") {
            throw new AppError(400, "onboarding_completed must be boolean", "VALIDATION_ERROR");
        }

        validateTaxFields(b);

        return next();
    } catch (err) {
        return next(err);
    }
};
