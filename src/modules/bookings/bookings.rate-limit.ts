// ============================================================
// SalonOx — Public booking: rate limiting & abuse protection
// ============================================================
//
// POST /api/v1/bookings is unauthenticated and every successful call creates a
// client row plus an appointment. Without a limiter a single script can fill a
// salon's calendar and pollute its client list, which is BUG-OB-010.
//
// Three layers, because one key alone is always wrong somewhere:
//   • per IP          — the usual flood, but a whole salon behind one NAT
//                       (a mall, an office) shares an IP, so this is generous.
//   • per IP + salon  — stops one source hammering one salon specifically.
//   • per phone       — the abuse that matters most is many bookings for one
//                       fabricated identity, which the IP limits miss when the
//                       attacker rotates address.
//
// Fail-open on Redis trouble: an outage in the limiter must never take the
// booking flow down with it — same stance as the login limiter.

import { RateLimiterRedis } from "rate-limiter-flexible";
import { Request, Response, NextFunction } from "express";
import redis from "../../config/redis";
import logger from "../../config/logger";

// Deliberately roomy. A real customer books once, occasionally twice; a family
// booking several appointments in a sitting is legitimate and must not trip.
const byIp = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "booking_ip",
  points: 12,           // 12 bookings…
  duration: 60 * 60,    // …per hour from one address
  blockDuration: 60 * 15,
});

const byIpSalon = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "booking_ip_salon",
  points: 6,
  duration: 60 * 10,
  blockDuration: 60 * 10,
});

const byPhone = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "booking_phone",
  points: 5,
  duration: 60 * 60 * 24,
  blockDuration: 60 * 30,
});

// Reads and availability are cheap but not free, and the endpoint fans out into
// several date-range queries — worth a ceiling well above real browsing.
const byIpRead = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "booking_read_ip",
  points: 240,
  duration: 60,
  blockDuration: 60,
});

const clientIp = (req: Request): string =>
  (req.ip || req.socket?.remoteAddress || "unknown").toString();

function tooMany(res: Response, msBeforeNext: number) {
  const seconds = Math.max(1, Math.ceil(msBeforeNext / 1000));
  res.set("Retry-After", String(seconds));
  return res.status(429).json({
    success: false,
    error: {
      code: "RATE_LIMITED",
      // Phrased for a real customer who hit this by accident, not for an
      // attacker — they get the same message either way.
      message: `Too many booking attempts. Please try again in ${
        seconds >= 60 ? `${Math.ceil(seconds / 60)} minute(s)` : `${seconds} second(s)`
      }.`,
    },
  });
}

/** Guards the write endpoint. Consumes points before the booking is attempted. */
export async function bookingWriteRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = clientIp(req);
  const salonId = String(req.body?.salon_id || "unknown");
  const phoneDigits = String(req.body?.client_phone || "").replace(/\D/g, "");

  try {
    const checks: Promise<unknown>[] = [
      byIp.consume(ip),
      byIpSalon.consume(`${ip}:${salonId}`),
    ];
    if (phoneDigits.length >= 7) checks.push(byPhone.consume(phoneDigits));

    await Promise.all(checks);
    return next();
  } catch (rejection: any) {
    // rate-limiter-flexible rejects with the limiter result on a hit, and with
    // a real Error if Redis itself failed — only the former is a rate limit.
    if (rejection instanceof Error) {
      logger.error("[booking-rate-limit] limiter unavailable, allowing request", {
        message: rejection.message,
      });
      return next(); // fail open
    }
    logger.warn("[booking-rate-limit] blocked booking attempt", { ip, salonId });
    return tooMany(res, rejection?.msBeforeNext ?? 60_000);
  }
}

/** Guards the public read endpoints (salon lookup, availability). */
export async function bookingReadRateLimit(req: Request, res: Response, next: NextFunction) {
  try {
    await byIpRead.consume(clientIp(req));
    return next();
  } catch (rejection: any) {
    if (rejection instanceof Error) return next(); // fail open
    return tooMany(res, rejection?.msBeforeNext ?? 60_000);
  }
}
