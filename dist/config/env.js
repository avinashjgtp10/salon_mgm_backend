"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env.local') });
/**
 * ✅ Helper for required env variables
 * (does NOT affect existing config)
 */
function required(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env: ${name}`);
    return v;
}
const config = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000'),
    apiVersion: process.env.API_VERSION || 'v1',
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        name: process.env.DB_NAME || 'salon_dev',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL === 'true',
    },
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || '0'),
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'your-secret-key',
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'your-refresh-secret',
        refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
    },
    cors: {
        allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3001').split(','),
    },
    frontend: {
        url: process.env.FRONTEND_URL || 'http://localhost:3001',
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
    },
    /**
     * ✅ NEW SMTP CONFIG
     */
    smtp: {
        host: required("SMTP_HOST"),
        port: Number(required("SMTP_PORT")),
        user: required("SMTP_USER"),
        pass: required("SMTP_PASS"),
        from: required("EMAIL_FROM"),
    },
    /**
     * ✅ NEW OTP CONFIG
     */
    otp: {
        expMinutes: Number(process.env.OTP_EXP_MINUTES || 10),
    },
};
exports.default = config;
//# sourceMappingURL=env.js.map