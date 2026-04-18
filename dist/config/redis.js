"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ioredis_1 = __importDefault(require("ioredis"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: '.env.local' });
const redis = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
});
redis.on('connect', () => {
    console.log('✅ Redis connected');
});
redis.on('error', (err) => {
    console.error('❌ Redis error:', err);
});
exports.default = redis;
//# sourceMappingURL=redis.js.map