"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCheckoutSale = exports.validateUpdateSale = exports.validateCreateSale = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (v) => typeof v === "string" && UUID_RE.test(v);
const validateCreateSale = (req, _res, next) => {
    try {
        const b = req.body;
        if (!b.salon_id || !isUUID(b.salon_id)) {
            throw new error_middleware_1.AppError(400, "salon_id is required and must be a UUID", "VALIDATION_ERROR");
        }
        if (!Array.isArray(b.items) || b.items.length === 0) {
            throw new error_middleware_1.AppError(400, "items array is required and cannot be empty", "VALIDATION_ERROR");
        }
        for (const item of b.items) {
            if (!["service", "product", "membership", "gift_card"].includes(item.item_type)) {
                throw new error_middleware_1.AppError(400, "Invalid item_type in items", "VALIDATION_ERROR");
            }
            if (!item.name || typeof item.quantity !== "number" || typeof item.unit_price !== "string") {
                throw new error_middleware_1.AppError(400, "Each item must have a name, quantity, and unit_price", "VALIDATION_ERROR");
            }
        }
        next();
    }
    catch (error) {
        next(error);
    }
};
exports.validateCreateSale = validateCreateSale;
const validateUpdateSale = (req, _res, next) => {
    try {
        if (Object.keys(req.body).length === 0) {
            throw new error_middleware_1.AppError(400, "At least one field to update must be provided", "VALIDATION_ERROR");
        }
        next();
    }
    catch (error) {
        next(error);
    }
};
exports.validateUpdateSale = validateUpdateSale;
const validateCheckoutSale = (req, _res, next) => {
    try {
        const { payment_method } = req.body;
        if (!payment_method || !["cash", "card", "gift_card", "split", "upi"].includes(payment_method)) {
            throw new error_middleware_1.AppError(400, "A valid payment_method is required (cash, card, gift_card, split, upi)", "VALIDATION_ERROR");
        }
        next();
    }
    catch (error) {
        next(error);
    }
};
exports.validateCheckoutSale = validateCheckoutSale;
//# sourceMappingURL=sales.validator.js.map