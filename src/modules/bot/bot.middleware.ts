import { Request, Response, NextFunction } from 'express';

const requestCounts = new Map<string, { count: number; startTime: number }>();

export function botRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 30;

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, startTime: now });
    return next();
  }

  const record = requestCounts.get(ip)!;

  if (now - record.startTime > windowMs) {
    requestCounts.set(ip, { count: 1, startTime: now });
    return next();
  }

  if (record.count >= maxRequests) {
    res.status(429).json({
      answer: 'Too many requests. Please wait a moment.',
      source: 'rate_limit',
    });
    return;
  }

  record.count++;
  next();
}

export function botLogger(req: Request, _res: Response, next: NextFunction): void {  if (req.path === '/api/v1/bot/ask' && req.method === 'POST') {
    const time = new Date().toISOString();
    console.log(`[BOT] ${time} — "${(req.body?.question as string)?.substring(0, 60)}"`);
  }
  next();
}