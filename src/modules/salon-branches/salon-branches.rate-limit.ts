import { RateLimiterRedis } from 'rate-limiter-flexible';
import redis from '../../config/redis';
import { AppError } from '../../middleware/error.middleware';

// Verifying another account's password is a credential-guessing oracle, so it is limited per owner + IP:
// 5 failed verifications in 10 minutes blocks that owner for 10 minutes. Fail-open if Redis is down, like login.
const verifyFailLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'branch_verify_fail',
  points: 5,
  duration: 600,
  blockDuration: 600,
});

const key = (userId: string, ip: string) => `${userId}:${ip}`;

export async function assertVerifyNotBlocked(userId: string, ip: string): Promise<void> {
  let info;
  try { info = await verifyFailLimiter.get(key(userId, ip)); } catch { return; }
  if (info && info.consumedPoints >= 5 && info.msBeforeNext > 0) {
    throw new AppError(
      429,
      `Too many failed attempts. Try again in ${Math.ceil(info.msBeforeNext / 60000)} minute(s).`,
      'RATE_LIMIT',
    );
  }
}

export async function recordVerifyFail(userId: string, ip: string): Promise<void> {
  try { await verifyFailLimiter.consume(key(userId, ip), 1); } catch { /* blocked now, or Redis down */ }
}

export async function resetVerifyFails(userId: string, ip: string): Promise<void> {
  try { await verifyFailLimiter.delete(key(userId, ip)); } catch { /* ignore */ }
}
