import winston from 'winston';
import path from 'path';
import config from './env';
import { SolarWindsTransport } from './solarwindsTransport';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        return `${timestamp} [${level}]: ${message} ${
          Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
        }`;
      })
    ),
  }),
  new winston.transports.File({
    filename: path.join('logs', 'error.log'),
    level: 'error',
  }),
  new winston.transports.File({
    filename: path.join('logs', 'combined.log'),
  }),
];

// SolarWinds Observability (Papertrail) — only active when the token is
// configured. Lets this stay a no-op on every environment that hasn't
// opted in (QA, PROD, other devs' machines).
if (process.env.SOLARWINDS_LOG_TOKEN) {
  transports.push(
    new SolarWindsTransport({
      endpoint: process.env.SOLARWINDS_LOG_ENDPOINT ||
        'https://logs.collector.ap-01.cloud.solarwinds.com/v1/logs',
      token: process.env.SOLARWINDS_LOG_TOKEN,
      serviceName: process.env.SOLARWINDS_SERVICE_NAME || `salonox-backend-${config.env}`,
    })
  );
}

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'salon-backend' },
  transports,
});

export default logger;
