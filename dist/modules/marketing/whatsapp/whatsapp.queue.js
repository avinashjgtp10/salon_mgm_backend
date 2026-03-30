"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignQueue = exports.redisConnection = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
exports.redisConnection = new ioredis_1.default({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD ?? undefined,
    maxRetriesPerRequest: null,
});
exports.campaignQueue = new bullmq_1.Queue('wa-campaign-messages', {
    connection: exports.redisConnection,
});
//# sourceMappingURL=whatsapp.queue.js.map