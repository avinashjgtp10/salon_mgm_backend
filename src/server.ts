import app from './app';
import config from './config/env';
import logger from './config/logger';
import db from './config/database';
import redis from './config/redis';

const PORT = config.port;

// Test database connection
db.query('SELECT NOW()')
  .then(() => {
    logger.info('✅ Database connection successful');
  })
  .catch((err) => {
    logger.error('❌ Database connection failed:', err);
    process.exit(1);
  });

// Test Redis connection
redis.ping().then(() => {
  logger.info('✅ Redis connection successful');
});

// Start server
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📍 Environment: ${config.env}`);
  logger.info(`🌐 API: http://localhost:${PORT}/api/${config.apiVersion}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    db.end();
    redis.quit();
    process.exit(0);
  });
});
