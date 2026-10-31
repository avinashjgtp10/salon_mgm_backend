import winston from 'winston';
import path from 'path';
import config from './env';
import { SolarWindsTransport } from './solarwindsTransport';

// Many call sites do logger.error('msg:', err?.message). winston's splat format
// treats a bare string as meta and spreads it into {"0":"c","1":"o",...}, which
// loses the text. Append primitive extras to the message instead (unless the
// message uses %s-style placeholders, which splat handles itself).
const SPLAT = Symbol.for('splat');
const appendPrimitiveArgs = winston.format((info) => {
  const splat = (info as any)[SPLAT];
  if (Array.isArray(splat) && !/%[sdifjoO%]/.test(String(info.message))) {
    const extras: string[] = [];
    const rest: unknown[] = [];
    for (const arg of splat) {
      if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
        extras.push(String(arg));
      } else {
        rest.push(arg);
      }
    }
    if (extras.length) {
      info.message = `${info.message} ${extras.join(' ')}`;
      (info as any)[SPLAT] = rest;
    }
  }
  return info;
});

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
      // Follows the app log level unless overridden, so debug never ships in
      // production. Noise is cut at the source, not filtered here.
      level: process.env.SOLARWINDS_LOG_LEVEL || config.logging.level,
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
    appendPrimitiveArgs(),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'salon-backend' },
  transports,
});

export default logger;
