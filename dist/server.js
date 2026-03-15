"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const env_1 = __importDefault(require("./config/env"));
const logger_1 = __importDefault(require("./config/logger"));
const database_1 = __importDefault(require("./config/database"));
const redis_1 = __importDefault(require("./config/redis"));
const PORT = env_1.default.port;
// Test database connection
database_1.default.query('SELECT NOW()')
    .then(() => {
    logger_1.default.info('✅ Database connection successful');
})
    .catch((err) => {
    logger_1.default.error('❌ Database connection failed:', err);
    process.exit(1);
});
// Test Redis connection
redis_1.default.ping().then(() => {
    logger_1.default.info('✅ Redis connection successful');
});
// Start server
const server = app_1.default.listen(PORT, () => {
    logger_1.default.info(`🚀 Server running on port ${PORT}`);
    logger_1.default.info(`📍 Environment: ${env_1.default.env}`);
    logger_1.default.info(`🌐 API: http://localhost:${PORT}/api/${env_1.default.apiVersion}`);
});
// Graceful shutdown
process.on('SIGTERM', () => {
    logger_1.default.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        logger_1.default.info('HTTP server closed');
        database_1.default.end();
        redis_1.default.quit();
        process.exit(0);
    });
});
//# sourceMappingURL=server.js.map