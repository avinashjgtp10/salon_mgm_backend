"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCreateWAUser = exports.validateCreateCampaign = exports.validateCreateTemplate = exports.validateSaveConfig = void 0;
const error_middleware_1 = require("../../../middleware/error.middleware");
const isString = (v) => typeof v === 'string';
const isNonEmpty = (v) => isString(v) && v.trim().length > 0;
const isUUID = (v) => typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
// ─── Config ───────────────────────────────────────────────────────────────────
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
// ─── Templates ────────────────────────────────────────────────────────────────
const VALID_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const VALID_HEADER_TYPES = ['none', 'text', 'image', 'video', 'document'];
const VALID_LANGUAGES = ['en_US', 'hi_IN', 'mr_IN', 'ta_IN', 'te_IN', 'en'];
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
                if (!['quick_reply', 'url', 'phone'].includes(btn.type))
                    throw new error_middleware_1.AppError(400, 'button type must be quick_reply, url or phone', 'VALIDATION_ERROR');
                if (!isNonEmpty(btn.text))
                    throw new error_middleware_1.AppError(400, 'button text is required', 'VALIDATION_ERROR');
                if (btn.type === 'url' && !isNonEmpty(btn.value))
                    throw new error_middleware_1.AppError(400, 'button value (url) is required for url type', 'VALIDATION_ERROR');
                if (btn.type === 'phone' && !isNonEmpty(btn.value))
                    throw new error_middleware_1.AppError(400, 'button value (phone number) is required for phone type', 'VALIDATION_ERROR');
            }
        }
        return next();
    }
    catch (e) {
        return next(e);
    }
};
exports.validateCreateTemplate = validateCreateTemplate;
// ─── Campaigns ────────────────────────────────────────────────────────────────
const validateCreateCampaign = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmpty(b.name))
            throw new error_middleware_1.AppError(400, 'name is required', 'VALIDATION_ERROR');
        if (!isUUID(b.template_id))
            throw new error_middleware_1.AppError(400, 'template_id must be a valid UUID', 'VALIDATION_ERROR');
        if (!Array.isArray(b.contacts) || b.contacts.length === 0)
            throw new error_middleware_1.AppError(400, 'contacts must be a non-empty array', 'VALIDATION_ERROR');
        for (let i = 0; i < b.contacts.length; i++) {
            if (!isNonEmpty(b.contacts[i].phone))
                throw new error_middleware_1.AppError(400, `contacts[${i}].phone is required`, 'VALIDATION_ERROR');
        }
        if (b.batch_size !== undefined) {
            const bs = Number(b.batch_size);
            if (!Number.isInteger(bs) || bs < 1 || bs > 500)
                throw new error_middleware_1.AppError(400, 'batch_size must be between 1 and 500', 'VALIDATION_ERROR');
        }
        return next();
    }
    catch (e) {
        return next(e);
    }
};
exports.validateCreateCampaign = validateCreateCampaign;
// ─── WA Users ─────────────────────────────────────────────────────────────────
const VALID_WA_ROLES = ['salon_owner', 'staff', 'admin'];
const validateCreateWAUser = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmpty(b.first_name))
            throw new error_middleware_1.AppError(400, 'first_name is required', 'VALIDATION_ERROR');
        if (!isNonEmpty(b.last_name))
            throw new error_middleware_1.AppError(400, 'last_name is required', 'VALIDATION_ERROR');
        if (!isNonEmpty(b.email))
            throw new error_middleware_1.AppError(400, 'email is required', 'VALIDATION_ERROR');
        if (!isNonEmpty(b.password) || b.password.length < 6)
            throw new error_middleware_1.AppError(400, 'password must be at least 6 characters', 'VALIDATION_ERROR');
        if (!VALID_WA_ROLES.includes(b.role))
            throw new error_middleware_1.AppError(400, `role must be one of: ${VALID_WA_ROLES.join(', ')}`, 'VALIDATION_ERROR');
        return next();
    }
    catch (e) {
        return next(e);
    }
};
exports.validateCreateWAUser = validateCreateWAUser;
//# sourceMappingURL=whatsapp.validator.js.map