"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const env_1 = __importDefault(require("./env"));
const logger = winston_1.default.createLogger({
    level: env_1.default.logging.level,
    format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.splat(), winston_1.default.format.json()),
    defaultMeta: { service: 'salon-backend' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
                return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
            })),
        }),
        new winston_1.default.transports.File({
            filename: path_1.default.join('logs', 'error.log'),
            level: 'error',
        }),
        new winston_1.default.transports.File({
            filename: path_1.default.join('logs', 'combined.log'),
        }),
    ],
});
exports.default = logger;
//# sourceMappingURL=logger.js.map