"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSaveConfig = void 0;
const error_middleware_1 = require("../../../../middleware/error.middleware");
const isNonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const validateSaveConfig = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmpty(b.phone_number_id))
            throw new error_middleware_1.AppError(400, 'phone_number_id is required', 'VALIDATION_ERROR');
        if (!isNonEmpty(b.waba_id))
            throw new error_middleware_1.AppError(400, 'waba_id is required', 'VALIDATION_ERROR');
        if (!isNonEmpty(b.access_token))
            throw new error_middleware_1.AppError(400, 'access_token is required', 'VALIDATION_ERROR');
        if (!isNonEmpty(b.webhook_verify_token))
            throw new error_middleware_1.AppError(400, 'webhook_verify_token is required', 'VALIDATION_ERROR');
        return next();
    }
    catch (e) {
        return next(e);
    }
};
exports.validateSaveConfig = validateSaveConfig;
//# sourceMappingURL=config.validator.js.map