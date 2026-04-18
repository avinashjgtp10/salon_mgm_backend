"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.corsMiddleware = void 0;
const cors_1 = __importDefault(require("cors"));
const logger_1 = __importDefault(require("../config/logger"));
const corsOptions = (req, callback) => {
    const originHeader = req.header("Origin");
    // Normalize origin (remove trailing slash if any)
    const origin = originHeader ? originHeader.replace(/\/$/, "") : undefined;
    // Retrieve dynamically to ensure env lets it load even if imported early
    const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
        ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, ""))
        : [];
    // Log incoming request origin
    logger_1.default.info(`CORS check - Incoming Origin: ${origin || "No Origin (Postman/Mobile)"}`);
    // Postman / mobile apps (no origin header)
    if (!origin) {
        logger_1.default.info("CORS allowed: No origin detected (Postman or mobile request)");
        return callback(null, {
            origin: true,
            credentials: true,
        });
    }
    if (allowedOrigins.includes(origin)) {
        logger_1.default.info(`CORS allowed for origin: ${origin}`);
        callback(null, {
            origin: true,
            credentials: true,
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-timezone", "x-currency"],
        });
    }
    else {
        logger_1.default.warn(`CORS blocked for origin: ${origin}. Allowed origins: ${allowedOrigins.join(", ")}`);
        callback(new Error("Not allowed by CORS"));
    }
};
exports.corsMiddleware = (0, cors_1.default)(corsOptions);
//# sourceMappingURL=cors.middleware.js.map