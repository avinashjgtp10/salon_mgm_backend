import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { isValidTaxRegistrationNumber, TAX_ID_ERROR } from "./tax-id";

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v: unknown) => v === undefined || typeof v === "string";

const PAN_FORMAT_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const validateTaxFields = (b: Record<string, unknown>) => {
    if (b.gst_number !== undefined && b.gst_number !== "" && !isValidTaxRegistrationNumber(String(b.gst_number))) {
        throw new AppError(400, `gst_number ${TAX_ID_ERROR}`, "VALIDATION_ERROR");
    }
    if (b.pan_number !== undefined && b.pan_number !== "" && !PAN_FORMAT_RE.test(String(b.pan_number).toUpperCase())) {
        throw new AppError(400, "pan_number must be a valid 10-character PAN (e.g. AAAAA0000A)", "VALIDATION_ERROR");
    }
};

// Shape only (an array of strings, not absurdly long); the real rules - digits, de-duplication, the cap and
// "not the primary number" - are applied in salons.service.ts, which also knows the stored primary number.
const validateAdditionalPhones = (b: Record<string, unknown>) => {
    if (b.additional_phones === undefined) return;
    if (!Array.isArray(b.additional_phones) || b.additional_phones.length > 20
        || b.additional_phones.some((p) => typeof p !== "string" || p.length > 30)) {
        throw new AppError(400, "additional_phones must be a list of phone numbers", "VALIDATION_ERROR");
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
        validateAdditionalPhones(b);

        return next();
    } catch (err) {
        return next(err);
    }
};

const isValidTimezone = (tz: unknown): boolean => {
    if (typeof tz !== "string" || !tz) return false;
    try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
    } catch {
        return false;
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

        if (b.timezone !== undefined && !isValidTimezone(b.timezone)) {
            throw new AppError(400, "timezone must be a valid IANA timezone (e.g. Asia/Kolkata)", "VALIDATION_ERROR");
        }

        if (b.is_active !== undefined && typeof b.is_active !== "boolean") {
            throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");
        }

        if (b.onboarding_completed !== undefined && typeof b.onboarding_completed !== "boolean") {
            throw new AppError(400, "onboarding_completed must be boolean", "VALIDATION_ERROR");
        }

        validateTaxFields(b);
        validateAdditionalPhones(b);

        return next();
    } catch (err) {
        return next(err);
    }
};
