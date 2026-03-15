"use strict";
// src/middleware/role.middleware.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.protect = exports.roleMiddleware = void 0;
const error_middleware_1 = require("./error.middleware");
const roleMiddleware = (...allowedRoles) => (req, _res, next) => {
    try {
        const user = req.user;
        if (!user?.userId) {
            throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
        }
        const role = user.role;
        if (!role) {
            throw new error_middleware_1.AppError(403, "Role missing", "ROLE_MISSING");
        }
        if (!allowedRoles.includes(role)) {
            throw new error_middleware_1.AppError(403, "Forbidden", "FORBIDDEN");
        }
        return next();
    }
    catch (error) {
        return next(error);
    }
};
exports.roleMiddleware = roleMiddleware;
// ✅ This is protect (alias)
exports.protect = exports.roleMiddleware;
//# sourceMappingURL=role.middleware.js.map