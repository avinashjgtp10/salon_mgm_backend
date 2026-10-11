// Email OTP gate for changing a salon's WhatsApp credentials (Super Admin).
//
// Saving or disconnecting a salon's WhatsApp connection needs a one-time code
// that is emailed to a fixed approver address - not to the logged-in admin - so
// a hijacked super-admin session alone cannot swap credentials.
//
//   request  -> 6-digit code emailed to the approver (valid 10 min, 1 per 30 s)
//   verify   -> correct code opens a 10-minute window for THIS admin + salon
//   gate     -> PUT / DELETE need that window, and it is used up by one success
//
// State lives in Redis only (no migration): hashed code, attempt counter,
// resend cooldown and the verified marker.
import { Request, Response, NextFunction } from 'express'
import redis from '../../../../config/redis'
import logger from '../../../../config/logger'
import { AppError } from '../../../../middleware/error.middleware'
import { generateOtp, hashOtp, compareOtp, isValidOtp } from '../../../utils/otp.util'
import { emailService } from '../../../utils/email.service'

const OTP_TTL_SECONDS      = 10 * 60
const VERIFIED_TTL_SECONDS = 10 * 60
const COOLDOWN_SECONDS     = 30
const MAX_ATTEMPTS         = 5

// The mailbox that receives the codes. Override with WA_CONFIG_OTP_EMAIL.
const approverEmail = () =>
  (process.env.WA_CONFIG_OTP_EMAIL ?? 'zanzane8777@gmail.com').trim().toLowerCase()

const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, (_m, a, b) => `${a}***${b}`)

const k = {
  otp:      (a: string, s: string) => `wa-cfg:otp:${a}:${s}`,
  tries:    (a: string, s: string) => `wa-cfg:tries:${a}:${s}`,
  cooldown: (a: string, s: string) => `wa-cfg:cool:${a}:${s}`,
  ok:       (a: string, s: string) => `wa-cfg:ok:${a}:${s}`,
}

export const configOtpService = {

  async request(adminId: string, salonId: string) {
    // SET NX = only the first request inside the cooldown window goes through.
    const first = await redis.set(k.cooldown(adminId, salonId), '1', 'EX', COOLDOWN_SECONDS, 'NX')
    if (!first) throw new AppError(429, `Please wait ${COOLDOWN_SECONDS} seconds before requesting another code`, 'OTP_COOLDOWN')

    const otp = generateOtp()
    await redis.set(k.otp(adminId, salonId), await hashOtp(otp), 'EX', OTP_TTL_SECONDS)
    await redis.del(k.tries(adminId, salonId))

    const to = approverEmail()
    try {
      await emailService.sendWhatsAppConfigOtpEmail(to, otp, salonId)
    } catch (err: any) {
      await redis.del(k.otp(adminId, salonId), k.cooldown(adminId, salonId))
      logger.error('[configOtpService.request] email failed', { error: err?.message })
      throw new AppError(500, 'Could not send the OTP email. Please try again.', 'EMAIL_SEND_FAILED')
    }
    return { sent_to: maskEmail(to), expires_in: OTP_TTL_SECONDS }
  },

  async verify(adminId: string, salonId: string, codeRaw: unknown) {
    const code = String(codeRaw ?? '').trim()
    if (!isValidOtp(code)) throw new AppError(400, 'Enter the 6-digit code', 'VALIDATION_ERROR')

    const hash = await redis.get(k.otp(adminId, salonId))
    if (!hash) throw new AppError(400, 'Code expired or not requested - request a new one', 'OTP_NOT_FOUND')

    const tries = await redis.incr(k.tries(adminId, salonId))
    if (tries === 1) await redis.expire(k.tries(adminId, salonId), OTP_TTL_SECONDS)
    if (tries > MAX_ATTEMPTS) {
      await redis.del(k.otp(adminId, salonId))
      throw new AppError(429, 'Too many wrong attempts - request a new code', 'OTP_LOCKED')
    }

    if (!(await compareOtp(code, hash))) throw new AppError(400, 'Incorrect code', 'OTP_INVALID')

    await redis.del(k.otp(adminId, salonId), k.tries(adminId, salonId))
    await redis.set(k.ok(adminId, salonId), '1', 'EX', VERIFIED_TTL_SECONDS)
    return { verified: true, expires_in: VERIFIED_TTL_SECONDS }
  },

  async status(adminId: string, salonId: string) {
    const ttl = await redis.ttl(k.ok(adminId, salonId))
    return { verified: ttl > 0, expires_in: ttl > 0 ? ttl : 0, sent_to: maskEmail(approverEmail()) }
  },

  // Middleware for the credential-changing routes (PUT / DELETE).
  requireVerified: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminId = (req as any).user?.userId as string | undefined
      const salonId = String(req.params.salonId ?? '')
      if (!adminId || !salonId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED')
      if (!(await redis.exists(k.ok(adminId, salonId)))) {
        throw new AppError(428, 'Email OTP verification is required to change WhatsApp credentials', 'WA_CONFIG_OTP_REQUIRED')
      }
      // One verification = one change: used up once the request succeeds.
      res.on('finish', () => {
        if (res.statusCode < 400) redis.del(k.ok(adminId, salonId)).catch(() => {})
      })
      return next()
    } catch (e) {
      return next(e)
    }
  },
}
