"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleStartQuerySchema = exports.googleCallbackQuerySchema = exports.validateRefresh = exports.validateLogin = exports.validateRegister = void 0;
const zod_1 = require("zod");
const error_middleware_1 = require("../../middleware/error.middleware");
/**
 * REGISTER VALIDATION
 */
const validateRegister = (req, _res, next) => {
    const { email, password, first_name, role } = req.body;
    if (!email) {
        return next(new error_middleware_1.AppError(400, "Email is required", "VALIDATION_ERROR"));
    }
    if (!password || password.length < 8) {
        return next(new error_middleware_1.AppError(400, "Password must be at least 8 characters", "VALIDATION_ERROR"));
    }
    if (!first_name) {
        return next(new error_middleware_1.AppError(400, "First name is required", "VALIDATION_ERROR"));
    }
    const allowedRoles = ["salon_owner", "staff", "client", "admin"];
    if (!role || !allowedRoles.includes(role)) {
        return next(new error_middleware_1.AppError(400, "Role must be salon_owner, staff, client or admin", "VALIDATION_ERROR"));
    }
    next();
};
exports.validateRegister = validateRegister;
/**
 * LOGIN VALIDATION
 */
const validateLogin = (req, _res, next) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return next(new error_middleware_1.AppError(400, "Email and password required", "VALIDATION_ERROR"));
    }
    next();
};
exports.validateLogin = validateLogin;
/**
 * REFRESH TOKEN VALIDATION
 */
const validateRefresh = (req, _res, next) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return next(new error_middleware_1.AppError(400, "refreshToken required", "VALIDATION_ERROR"));
    }
    next();
};
exports.validateRefresh = validateRefresh;
exports.googleCallbackQuerySchema = zod_1.z.object({
    code: zod_1.z.string().min(1, "code required"),
    state: zod_1.z.string().min(1, "state required"),
});
exports.googleStartQuerySchema = zod_1.z.object({
    returnTo: zod_1.z.string().optional(),
});
//# sourceMappingURL=auth.validator.js.map