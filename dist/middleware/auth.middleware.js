"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const error_middleware_1 = require("./error.middleware");
const authMiddleware = (req, _res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            throw new error_middleware_1.AppError(401, "Authorization header missing", "NO_AUTH_HEADER");
        }
        const [type, token] = authHeader.split(" ");
        if (type !== "Bearer" || !token) {
            throw new error_middleware_1.AppError(401, "Invalid token format", "INVALID_TOKEN_FORMAT");
        }
        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) {
            throw new error_middleware_1.AppError(500, "JWT access secret missing", "JWT_SECRET_MISSING");
        }
        const decoded = jsonwebtoken_1.default.verify(token, secret);
        req.user = decoded;
        return next();
    }
    catch (err) {
        return next(new error_middleware_1.AppError(401, "Unauthorized", "INVALID_TOKEN"));
    }
};
exports.authMiddleware = authMiddleware;
//# sourceMappingURL=auth.middleware.js.map