"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateStartTrial = exports.validateCreateSubscription = exports.validateCreatePlan = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const VALID_BILLING_CYCLES = ["daily", "weekly", "monthly", "yearly"];
const validateCreatePlan = (req, _res, next) => {
    try {
        const b = req.body;
        if (!b.name || typeof b.name !== "string")
            throw new error_middleware_1.AppError(400, "name is required", "VALIDATION_ERROR");
        if (!b.slug || typeof b.slug !== "string")
            throw new error_middleware_1.AppError(400, "slug is required", "VALIDATION_ERROR");
        if (!b.price || typeof b.price !== "number" || b.price <= 0)
            throw new error_middleware_1.AppError(400, "price must be a positive number", "VALIDATION_ERROR");
        if (!VALID_BILLING_CYCLES.includes(b.billing_cycle))
            throw new error_middleware_1.AppError(400, `billing_cycle must be one of: ${VALID_BILLING_CYCLES.join(", ")}`, "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCreatePlan = validateCreatePlan;
const validateCreateSubscription = (req, _res, next) => {
    try {
        const b = req.body;
        if (!b.salon_id || typeof b.salon_id !== "string")
            throw new error_middleware_1.AppError(400, "salon_id is required", "VALIDATION_ERROR");
        if (!b.plan_id || typeof b.plan_id !== "string")
            throw new error_middleware_1.AppError(400, "plan_id is required", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCreateSubscription = validateCreateSubscription;
const validateStartTrial = (req, _res, next) => {
    try {
        const b = req.body;
        if (!b.salon_id || typeof b.salon_id !== "string")
            throw new error_middleware_1.AppError(400, "salon_id is required", "VALIDATION_ERROR");
        if (!b.plan_id || typeof b.plan_id !== "string")
            throw new error_middleware_1.AppError(400, "plan_id is required", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateStartTrial = validateStartTrial;
//# sourceMappingURL=subscriptions.validator.js.map