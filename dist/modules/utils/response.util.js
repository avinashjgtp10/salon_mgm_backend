"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendError = exports.sendSuccess = void 0;
const crypto_1 = require("crypto");
/**
 * Generate Meta Info
 */
const createMeta = () => ({
    timestamp: new Date().toISOString(),
    requestId: (0, crypto_1.randomUUID)(), // unique request tracking
});
/**
 * Success Response
 */
const sendSuccess = (res, statusCode, data, message) => {
    const response = {
        success: true,
        data,
        message,
        meta: createMeta(),
    };
    return res.status(statusCode).json(response);
};
exports.sendSuccess = sendSuccess;
/**
 * Error Response
 */
const sendError = (res, statusCode, code, message, details) => {
    const response = {
        success: false,
        error: {
            code,
            message,
            details,
        },
        meta: createMeta(),
    };
    return res.status(statusCode).json(response);
};
exports.sendError = sendError;
//# sourceMappingURL=response.util.js.map