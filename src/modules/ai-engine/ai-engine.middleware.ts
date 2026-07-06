import { NextFunction, Request, Response } from "express";

// Small per-salon rate limiter for the LUNOX chat endpoint, mirroring the
// pattern in src/modules/bot/bot.middleware.ts — bounds LLM usage from a
// single caller without needing a shared cache for this internal debug route.
const requestCounts = new Map<string, { count: number; startTime: number }>();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 20;

export function aiEngineRateLimiter(req: Request & { user?: any }, res: Response, next: NextFunction): void {
    const key = req.user?.salonId || req.ip || "unknown";
    const now = Date.now();

    const record = requestCounts.get(key);
    if (!record || now - record.startTime > WINDOW_MS) {
        requestCounts.set(key, { count: 1, startTime: now });
        return next();
    }

    if (record.count >= MAX_REQUESTS) {
        res.status(429).json({
            success: false,
            error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment." },
        });
        return;
    }

    record.count++;
    next();
}
