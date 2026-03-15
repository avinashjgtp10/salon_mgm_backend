"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMembershipsListQuery = exports.validateUpdateMembership = exports.validateCreateMembership = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const validateCreateMembership = (req, _res, next) => {
    try {
        const { name, price, sessionType, validFor, colour, enableOnlineSales, enableOnlineRedemption } = req.body;
        if (!name || typeof name !== "string")
            throw new error_middleware_1.AppError(400, "name is required", "VALIDATION_ERROR");
        if (price === undefined || isNaN(Number(price)))
            throw new error_middleware_1.AppError(400, "price is required and must be a number", "VALIDATION_ERROR");
        if (!sessionType)
            throw new error_middleware_1.AppError(400, "sessionType is required", "VALIDATION_ERROR");
        if (!validFor)
            throw new error_middleware_1.AppError(400, "validFor is required", "VALIDATION_ERROR");
        if (!colour)
            throw new error_middleware_1.AppError(400, "colour is required", "VALIDATION_ERROR");
        if (enableOnlineSales === undefined)
            throw new error_middleware_1.AppError(400, "enableOnlineSales is required", "VALIDATION_ERROR");
        if (enableOnlineRedemption === undefined)
            throw new error_middleware_1.AppError(400, "enableOnlineRedemption is required", "VALIDATION_ERROR");
        return next();
    }
    catch (e) {
        return next(e);
    }
};
exports.validateCreateMembership = validateCreateMembership;
const validateUpdateMembership = (_req, _res, next) => {
    try {
        return next();
    }
    catch (e) {
        return next(e);
    }
};
exports.validateUpdateMembership = validateUpdateMembership;
const validateMembershipsListQuery = (_req, _res, next) => {
    try {
        return next();
    }
    catch (e) {
        return next(e);
    }
};
exports.validateMembershipsListQuery = validateMembershipsListQuery;
//# sourceMappingURL=memberships.validator.js.map