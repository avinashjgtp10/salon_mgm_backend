"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCreateTemplate = void 0;
const error_middleware_1 = require("../../../../middleware/error.middleware");
const isNonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const VALID_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const VALID_HEADER_TYPES = ['none', 'text', 'image', 'video', 'document'];
const VALID_LANGUAGES = ['en_US', 'hi_IN', 'mr_IN', 'ta_IN', 'te_IN', 'en'];
const VALID_BUTTON_TYPES = ['quick_reply', 'url', 'phone'];
const validateCreateTemplate = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmpty(b.name))
            throw new error_middleware_1.AppError(400, 'name is required', 'VALIDATION_ERROR');
        if (!/^[a-z0-9_]+$/.test(b.name))
            throw new error_middleware_1.AppError(400, 'name must be lowercase letters, numbers and underscores only', 'VALIDATION_ERROR');
        if (!VALID_CATEGORIES.includes(b.category))
            throw new error_middleware_1.AppError(400, `category must be one of: ${VALID_CATEGORIES.join(', ')}`, 'VALIDATION_ERROR');
        if (!VALID_LANGUAGES.includes(b.language))
            throw new error_middleware_1.AppError(400, `language must be one of: ${VALID_LANGUAGES.join(', ')}`, 'VALIDATION_ERROR');
        if (!VALID_HEADER_TYPES.includes(b.header_type))
            throw new error_middleware_1.AppError(400, `header_type must be one of: ${VALID_HEADER_TYPES.join(', ')}`, 'VALIDATION_ERROR');
        if (b.header_type === 'text' && !isNonEmpty(b.header_text))
            throw new error_middleware_1.AppError(400, 'header_text is required when header_type is text', 'VALIDATION_ERROR');
        if (!isNonEmpty(b.body_text) || b.body_text.trim().length < 10)
            throw new error_middleware_1.AppError(400, 'body_text must be at least 10 characters', 'VALIDATION_ERROR');
        if (b.body_text.length > 1024)
            throw new error_middleware_1.AppError(400, 'body_text must be under 1024 characters', 'VALIDATION_ERROR');
        if (b.buttons !== undefined) {
            if (!Array.isArray(b.buttons))
                throw new error_middleware_1.AppError(400, 'buttons must be an array', 'VALIDATION_ERROR');
            if (b.buttons.length > 3)
                throw new error_middleware_1.AppError(400, 'maximum 3 buttons allowed', 'VALIDATION_ERROR');
            for (const btn of b.buttons) {
                if (!VALID_BUTTON_TYPES.includes(btn.type))
                    throw new error_middleware_1.AppError(400, 'button type must be quick_reply, url or phone', 'VALIDATION_ERROR');
                if (!isNonEmpty(btn.text))
                    throw new error_middleware_1.AppError(400, 'button text is required', 'VALIDATION_ERROR');
                if (btn.type === 'url' && !isNonEmpty(btn.value))
                    throw new error_middleware_1.AppError(400, 'button value (url) is required for url type', 'VALIDATION_ERROR');
                if (btn.type === 'phone' && !isNonEmpty(btn.value))
                    throw new error_middleware_1.AppError(400, 'button value (phone) is required for phone type', 'VALIDATION_ERROR');
            }
        }
        return next();
    }
    catch (e) {
        return next(e);
    }
};
exports.validateCreateTemplate = validateCreateTemplate;
//# sourceMappingURL=templates.validator.js.map