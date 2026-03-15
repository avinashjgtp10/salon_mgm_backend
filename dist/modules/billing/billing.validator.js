"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUpdateBillingSubscription = exports.validateSubscribeBilling = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (v) => typeof v === "string" && UUID_RE.test(v);
const isPositiveInt = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;
const isOptionalStr = (v) => v === undefined || v === null || typeof v === "string";
const VALID_PAYMENT_METHODS = ["card", "upi", "bank_transfer", "cash"];
const OPTIONAL_STR_FIELDS = [
    "card_holder_name",
    "card_last4",
    "card_brand",
    "card_expiry",
    "account_type",
    "billing_first_name",
    "billing_last_name",
    "billing_address",
    "vat_number",
];
// ─── Subscribe (Enable button on the form) ────────────────────────────────────
const validateSubscribeBilling = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isUUID(b.salon_id))
            throw new error_middleware_1.AppError(400, "salon_id is required and must be a UUID", "VALIDATION_ERROR");
        if (!isUUID(b.plan_id))
            throw new error_middleware_1.AppError(400, "plan_id is required and must be a UUID", "VALIDATION_ERROR");
        if (!isPositiveInt(b.quantity))
            throw new error_middleware_1.AppError(400, "quantity is required and must be a positive integer", "VALIDATION_ERROR");
        if (b.payment_method !== undefined && !VALID_PAYMENT_METHODS.includes(b.payment_method))
            throw new error_middleware_1.AppError(400, `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(", ")}`, "VALIDATION_ERROR");
        // card_expiry format MM/YY
        if (b.card_expiry !== undefined && !/^\d{2}\/\d{2}$/.test(b.card_expiry))
            throw new error_middleware_1.AppError(400, "card_expiry must be in MM/YY format", "VALIDATION_ERROR");
        // card_last4 — exactly 4 digits
        if (b.card_last4 !== undefined && !/^\d{4}$/.test(b.card_last4))
            throw new error_middleware_1.AppError(400, "card_last4 must be exactly 4 digits", "VALIDATION_ERROR");
        // vat_number max 18 chars
        if (b.vat_number !== undefined && typeof b.vat_number === "string" && b.vat_number.length > 18)
            throw new error_middleware_1.AppError(400, "vat_number must not exceed 18 characters", "VALIDATION_ERROR");
        for (const f of OPTIONAL_STR_FIELDS) {
            if (!isOptionalStr(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateSubscribeBilling = validateSubscribeBilling;
// ─── Update (change card / billing details) ───────────────────────────────────
const validateUpdateBillingSubscription = (req, _res, next) => {
    try {
        const b = req.body;
        if (b.quantity !== undefined && !isPositiveInt(b.quantity))
            throw new error_middleware_1.AppError(400, "quantity must be a positive integer", "VALIDATION_ERROR");
        if (b.payment_method !== undefined && !VALID_PAYMENT_METHODS.includes(b.payment_method))
            throw new error_middleware_1.AppError(400, `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(", ")}`, "VALIDATION_ERROR");
        if (b.card_expiry !== undefined && !/^\d{2}\/\d{2}$/.test(b.card_expiry))
            throw new error_middleware_1.AppError(400, "card_expiry must be in MM/YY format", "VALIDATION_ERROR");
        if (b.card_last4 !== undefined && !/^\d{4}$/.test(b.card_last4))
            throw new error_middleware_1.AppError(400, "card_last4 must be exactly 4 digits", "VALIDATION_ERROR");
        if (b.vat_number !== undefined && typeof b.vat_number === "string" && b.vat_number.length > 18)
            throw new error_middleware_1.AppError(400, "vat_number must not exceed 18 characters", "VALIDATION_ERROR");
        for (const f of OPTIONAL_STR_FIELDS) {
            if (!isOptionalStr(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateBillingSubscription = validateUpdateBillingSubscription;
//# sourceMappingURL=billing.validator.js.map