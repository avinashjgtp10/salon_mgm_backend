"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUpdateSalon = exports.validateCreateSalon = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v) => v === undefined || typeof v === "string";
const validateCreateSalon = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmptyString(b.business_name)) {
            throw new error_middleware_1.AppError(400, "business_name is required", "VALIDATION_ERROR");
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
            "gst_number",
            "pan_number",
        ];
        for (const f of optionalFields) {
            if (!isOptionalString(b[f])) {
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCreateSalon = validateCreateSalon;
const validateUpdateSalon = (req, _res, next) => {
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
            "gst_number",
            "pan_number",
        ];
        for (const f of optionalFields) {
            if (!isOptionalString(b[f])) {
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }
        if (b.is_active !== undefined && typeof b.is_active !== "boolean") {
            throw new error_middleware_1.AppError(400, "is_active must be boolean", "VALIDATION_ERROR");
        }
        if (b.onboarding_completed !== undefined && typeof b.onboarding_completed !== "boolean") {
            throw new error_middleware_1.AppError(400, "onboarding_completed must be boolean", "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateSalon = validateUpdateSalon;
//# sourceMappingURL=salons.validator.js.map