"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));

// ✅ Load .env.local for local, system env vars for production
const envPath = process.env.NODE_ENV === 'production'
    ? path_1.default.join(__dirname, '../../.env')
    : path_1.default.join(__dirname, '../../.env.local');

dotenv_1.default.config({ path: envPath });

function required(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env: ${name}`);
    return v;
}

const config = {
    // APP
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000'),
    apiVersion: process.env.API_VERSION || 'v1',

    // DATABASE - strictly from environment variables
    database: {
        host: required("DB_HOST"),
        port: parseInt(required("DB_PORT")),
        name: required("DB_NAME"),
        user: required("DB_USER"),
        password: required("DB_PASSWORD"),
        ssl: process.env.DB_SSL === 'true',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
    },

    // REDIS - single URL (Upstash)
    redis: {
        url: required("REDIS_URL"),
    },

    // JWT
    jwt: {
        secret: required("JWT_SECRET"),
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        refreshSecret: required("REFRESH_TOKEN_SECRET"),
        refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
    },

    // CORS & FRONTEND
    cors: {
        allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3001').split(','),
    },
    frontend: {
        url: process.env.FRONTEND_URL || 'http://localhost:3001',
    },

    // LOGGING
    logging: {
        level: process.env.LOG_LEVEL || 'info',
    },

    // SMTP
    smtp: {
        host: required("SMTP_HOST"),
        port: Number(required("SMTP_PORT")),
        user: required("SMTP_USER"),
        pass: required("SMTP_PASS"),
        from: required("EMAIL_FROM"),
    },

    // OTP
    otp: {
        expMinutes: Number(process.env.OTP_EXP_MINUTES || 10),
    },

    // GOOGLE OAUTH
    google: {
        clientId: required("GOOGLE_CLIENT_ID"),
        clientSecret: required("GOOGLE_CLIENT_SECRET"),
        redirectUri: required("GOOGLE_REDIRECT_URI"),
        oneTapClientId: required("GOOGLE_ONE_TAP_CLIENT_ID"),
    },

    // RAZORPAY
    razorpay: {
        keyId: required("RAZORPAY_KEY_ID"),
        keySecret: required("RAZORPAY_KEY_SECRET"),
        webhookSecret: required("RAZORPAY_WEBHOOK_SECRET"),
    },

    // EXOTEL SMS
    exotel: {
        accountSid: required("EXOTEL_ACCOUNT_SID"),
        smsAppId: required("EXOTEL_SMS_APP_ID"),
        smsAppSecret: required("EXOTEL_SMS_APP_SECRET"),
    },
};

exports.default = config;
//# sourceMappingURL=env.js.map