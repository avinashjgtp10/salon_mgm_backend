import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

// Fraction (0..1) of successful (<400), non-slow requests to log. Default 0:
// successes are not logged individually, errors and slow requests always are.
const successSampleRate = (): number => {
  const n = Number(process.env.LOG_HTTP_SUCCESS_SAMPLE_RATE);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
};

const slowRequestMs = (): number => {
  const n = Number(process.env.LOG_SLOW_REQUEST_MS);
  return Number.isFinite(n) && n > 0 ? n : 3000;
};

const SKIPPED_PATHS = new Set(['/health']);

/**
 * Decides whether (and at which level) a finished request is logged.
 * 5xx → error, auth/rate-limit failures and slow requests → warn,
 * other 4xx → info, sampled successes → info, everything else → not logged.
 */
export function requestLogLevel(
  status: number,
  durationMs: number,
  opts: { sampleRate: number; slowMs: number; random?: number },
): 'error' | 'warn' | 'info' | null {
  if (status >= 500) return 'error';
  if (status === 401 || status === 403 || status === 429) return 'warn';
  if (durationMs >= opts.slowMs) return 'warn';
  if (status >= 400) return 'info';
  return (opts.random ?? Math.random()) < opts.sampleRate ? 'info' : null;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Attaches a request/correlation ID (honouring a sane inbound X-Request-Id)
 * and logs a one-line summary per request when it is worth keeping. Never
 * logs query strings, bodies, headers or cookies.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const inbound = req.header('x-request-id');
  const requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (SKIPPED_PATHS.has(req.path)) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = requestLogLevel(res.statusCode, durationMs, {
      sampleRate: successSampleRate(),
      slowMs: slowRequestMs(),
    });
    if (!level) return;
    // The error handler already logged this failure (with its reason and the
    // same requestId); only repeat it here when the request was also slow.
    if (res.locals.errorLogged && durationMs < slowRequestMs()) return;

    // Route pattern (e.g. /clients/:id) keeps IDs and query strings out of logs.
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    logger.log(level, 'http request', {
      requestId,
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    });
  });

  next();
}
