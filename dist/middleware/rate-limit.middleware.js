"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeLoginLimitKey = makeLoginLimitKey;
exports.loginRateLimitCheck = loginRateLimitCheck;
exports.recordLoginFail = recordLoginFail;
exports.resetLoginFails = resetLoginFails;
const rate_limiter_flexible_1 = require("rate-limiter-flexible");
const redis_1 = __importDefault(require("../config/redis"));
/**
 * After 3 failed logins:
 * - block for 30 seconds
 * - window is 60 seconds (counts failures in last 60s)
 */
const loginFailLimiter = new rate_limiter_flexible_1.RateLimiterRedis({
    storeClient: redis_1.default,
    keyPrefix: "login_fail",
    points: 3, // 3 failures allowed
    duration: 60, // per 60 seconds
    blockDuration: 30 // block 30 seconds after points consumed
});
// Make strong key: email + IP
function makeLoginLimitKey(email, ip) {
    return `${email.toLowerCase().trim()}:${ip}`;
}
/**
 * Middleware: check if user is blocked BEFORE running login logic
 * Put this before controller in /login route.
 */
async function loginRateLimitCheck(req, res, next) {
    try {
        const email = String(req.body?.email || "").toLowerCase().trim();
        const ip = req.ip;
        if (!email)
            return next(); // if no email, just continue
        const key = makeLoginLimitKey(email, ip);
        const info = await loginFailLimiter.get(key);
        if (info && info.consumedPoints >= 3 && info.msBeforeNext > 0) {
            return res.status(429).json({
                success: false,
                message: `Too many failed attempts. Try again in ${Math.ceil(info.msBeforeNext / 1000)} seconds.`
            });
        }
        return next();
    }
    catch (err) {
        // If Redis is temporarily down, DON'T block login (fail-open)
        return next();
    }
}
/**
 * Call this ONLY when password is WRONG
 */
async function recordLoginFail(email, ip) {
    const key = makeLoginLimitKey(email, ip);
    return loginFailLimiter.consume(key, 1); // +1 failed attempt
}
/**
 * Call this when login is SUCCESS
 */
async function resetLoginFails(email, ip) {
    const key = makeLoginLimitKey(email, ip);
    return loginFailLimiter.delete(key);
}
//# sourceMappingURL=rate-limit.middleware.js.map