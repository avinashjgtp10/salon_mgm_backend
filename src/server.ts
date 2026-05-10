import './modules/marketing/whatsapp/queue/campaign.processor'
import http from 'http'
import app from './app'
import config from './config/env'
import logger from './config/logger'
import db from './config/database'
import redis from './config/redis'
import { initSocket } from './config/socket'
import { startCampaignScheduler, stopCampaignScheduler } from './modules/marketing/whatsapp/queue/campaign.scheduler'

const PORT = config.port

// Test database connection
db.query('SELECT NOW()')
  .then(() => { logger.info('✅ Database connection successful') })
  .catch((err) => {
    logger.error('❌ Database connection failed:', err)
    process.exit(1)
  })

// Test Redis connection
redis.ping().then(() => { logger.info('✅ Redis connection successful') })

// Create HTTP server and attach Socket.io
const httpServer = http.createServer(app)
initSocket(httpServer)
logger.info('🔌 Socket.io initialized')

// Start server
httpServer.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`)
  logger.info(`📍 Environment: ${config.env}`)
  logger.info(`🌐 API: http://localhost:${PORT}/api/${config.apiVersion}`)

  // Start campaign scheduler after server is ready
  startCampaignScheduler()
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server')
  stopCampaignScheduler()
  httpServer.close(() => {
    logger.info('HTTP server closed')
    db.end()
    redis.quit()
    process.exit(0)
  })
})