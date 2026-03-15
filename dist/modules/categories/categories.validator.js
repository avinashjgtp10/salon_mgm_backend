"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUpdateCategory = exports.validateCreateCategory = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v) => v === undefined || typeof v === "string";
const isOptionalNumber = (v) => v === undefined || typeof v === "number";
const validateCreateCategory = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmptyString(b.name)) {
            throw new error_middleware_1.AppError(400, "name is required", "VALIDATION_ERROR");
        }
        const optionalStringFields = ["description"];
        for (const f of optionalStringFields) {
            if (!isOptionalString(b[f])) {
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }
        if (!isOptionalNumber(b.display_order)) {
            throw new error_middleware_1.AppError(400, "display_order must be a number", "VALIDATION_ERROR");
        }
        if (b.is_active !== undefined && typeof b.is_active !== "boolean") {
            throw new error_middleware_1.AppError(400, "is_active must be boolean", "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCreateCategory = validateCreateCategory;
const validateUpdateCategory = (req, _res, next) => {
    try {
        const b = req.body;
        if (b.name !== undefined && !isNonEmptyString(b.name)) {
            throw new error_middleware_1.AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
        }
        const optionalStringFields = ["description"];
        for (const f of optionalStringFields) {
            if (!isOptionalString(b[f])) {
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }
        if (!isOptionalNumber(b.display_order)) {
            throw new error_middleware_1.AppError(400, "display_order must be a number", "VALIDATION_ERROR");
        }
        if (b.is_active !== undefined && typeof b.is_active !== "boolean") {
            throw new error_middleware_1.AppError(400, "is_active must be boolean", "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateCategory = validateUpdateCategory;
//# sourceMappingURL=categories.validator.js.map