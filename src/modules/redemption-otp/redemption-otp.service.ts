// WhatsApp OTP gate for redeeming a client's Package session / Membership benefit.
//
//   request  -> 6-digit code to the CLIENT's WhatsApp (valid 10 min, 1 per 30 s)
//   verify   -> correct code opens a 10-minute window for THIS salon + client
//   assert   -> redemption points need that window (only when the salon switched
//               the rule on in Settings > Extras; default OFF)
//
// State lives in Redis only (no migration): hashed code, attempt counter, resend
// cooldown and the verified marker - same shape as marketing/whatsapp/config/
// config-otp.service.ts.
//
// The verified window is deliberately NOT used up by one redemption: one
// checkout can legitimately hit several redemption points (a part-payment
// followed by the completing one, package sessions, wallet), and a single-use
// marker would make the second one fail mid-checkout.
import redis from "../../config/redis";
import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { generateOtp, hashOtp, compareOtp, isValidOtp } from "../utils/otp.util";
import { configRepository } from "../marketing/whatsapp/config/config.repository";
import { getPlatformSalonId } from "../client-announcements/platform-salon";
import { formatPhone } from "../whatsapp-automation/whatsapp-automation.service";
import { getRedemptionOtpConfig, isRedemptionOtpRequired, type RedeemKind } from "./redemption-otp.settings";
import { sendOtpTemplate, submitOtpTemplate } from "./redemption-otp.template";

const OTP_TTL_SECONDS = 10 * 60;
const VERIFIED_TTL_SECONDS = 10 * 60;
const COOLDOWN_SECONDS = 30;
const MAX_ATTEMPTS = 5;

const k = {
  otp: (s: string, c: string) => `redeem-otp:otp:${s}:${c}`,
  tries: (s: string, c: string) => `redeem-otp:tries:${s}:${c}`,
  cooldown: (s: string, c: string) => `redeem-otp:cool:${s}:${c}`,
  ok: (s: string, c: string) => `redeem-otp:ok:${s}:${c}`,
};

// "+91 •••••• 6381": country code, then everything but the last 4 digits hidden. `to` is the full E.164
// digit string; the country code is the part in front of the national number.
const maskPhone = (to: string, countryCode?: string | null) => {
  const cc = (countryCode ?? "").replace(/\D/g, "") || (to.length === 12 && to.startsWith("91") ? "91" : "");
  return `${cc ? `+${cc} ` : ""}${"•".repeat(6)} ${to.slice(-4)}`;
};

// Meta error codes meaning "no such (approved) template" - the platform account
// has not submitted it yet, or it is still pending approval.
const TEMPLATE_MISSING_CODES = new Set([132000, 132001]);

export const redemptionOtpService = {

  // True when any of `kinds` has its switch on (default: either).
  async isRequired(salonId: string, kinds: RedeemKind[] = ["package", "membership"]): Promise<boolean> {
    const cfg = await getRedemptionOtpConfig(salonId);
    return kinds.some((kd) => cfg[kd]);
  },

  async request(salonId: string, clientId: string, requesterId?: string) {
    if (!(await isRedemptionOtpRequired(salonId))) {
      throw new AppError(400, "Redemption OTP is not enabled for this salon", "OTP_NOT_ENABLED");
    }

    const { rows } = await pool.query(
      `SELECT phone_country_code, phone_number FROM clients WHERE id = $1 AND salon_id = $2`,
      [clientId, salonId],
    );
    const client = rows[0];
    if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");
    if (!client.phone_number) {
      throw new AppError(400, "This client has no WhatsApp number on file", "OTP_NO_PHONE");
    }
    const to = formatPhone(String(client.phone_number), client.phone_country_code);

    // SalonOx's own Meta account (Super Admin), not the salon's number.
    const platformSalonId = await getPlatformSalonId();
    const cfg = platformSalonId ? await configRepository.findBySalonId(platformSalonId) : null;
    if (!cfg?.phone_number_id || !cfg?.access_token) {
      logger.error("[redemption-otp] platform WhatsApp is not configured");
      throw new AppError(503, "OTP service is not available right now. Please contact support.", "OTP_NOT_AVAILABLE");
    }

    // SET NX = only the first request inside the cooldown window goes through.
    const first = await redis.set(k.cooldown(salonId, clientId), "1", "EX", COOLDOWN_SECONDS, "NX");
    if (!first) {
      throw new AppError(429, `Please wait ${COOLDOWN_SECONDS} seconds before requesting another code`, "OTP_COOLDOWN");
    }

    const code = generateOtp();
    await redis.set(k.otp(salonId, clientId), await hashOtp(code), "EX", OTP_TTL_SECONDS);
    await redis.del(k.tries(salonId, clientId));

    try {
      await sendOtpTemplate({ phoneNumberId: cfg.phone_number_id, accessToken: cfg.access_token, to, code });
    } catch (err: any) {
      await redis.del(k.otp(salonId, clientId), k.cooldown(salonId, clientId));
      const metaCode = Number(err?.response?.data?.error?.code);
      logger.error("[redemption-otp] send failed", { metaCode, error: err?.response?.data?.error?.message ?? err?.message });

      if (TEMPLATE_MISSING_CODES.has(metaCode)) {
        // First use (or still pending): submit the template so approval can start.
        // A duplicate-name rejection just means it is already submitted - ignore.
        if (cfg.waba_id) {
          await submitOtpTemplate(cfg.waba_id, cfg.access_token).catch((e: any) =>
            logger.info("[redemption-otp] template submit skipped", { error: e?.response?.data?.error?.message ?? e?.message }),
          );
        }
        throw new AppError(503, "The OTP message template is awaiting WhatsApp approval. Please try again later.", "OTP_TEMPLATE_NOT_APPROVED");
      }
      throw new AppError(502, "Could not send the OTP on WhatsApp. Please try again.", "OTP_SEND_FAILED");
    }

    logger.info("[redemption-otp] code sent", { salonId, clientId, requesterId });
    return { sent_to: maskPhone(to, client.phone_country_code), expires_in: OTP_TTL_SECONDS, resend_in: COOLDOWN_SECONDS };
  },

  async verify(salonId: string, clientId: string, codeRaw: unknown) {
    const code = String(codeRaw ?? "").trim();
    if (!isValidOtp(code)) throw new AppError(400, "Enter the 6-digit code", "VALIDATION_ERROR");

    const hash = await redis.get(k.otp(salonId, clientId));
    if (!hash) throw new AppError(400, "Code expired or not requested - request a new one", "OTP_NOT_FOUND");

    const tries = await redis.incr(k.tries(salonId, clientId));
    if (tries === 1) await redis.expire(k.tries(salonId, clientId), OTP_TTL_SECONDS);
    if (tries > MAX_ATTEMPTS) {
      await redis.del(k.otp(salonId, clientId));
      logger.warn("[redemption-otp] locked after too many attempts", { salonId, clientId });
      throw new AppError(429, "Too many wrong attempts - request a new code", "OTP_LOCKED");
    }

    if (!(await compareOtp(code, hash))) throw new AppError(400, "Incorrect code", "OTP_INVALID");

    await redis.del(k.otp(salonId, clientId), k.tries(salonId, clientId));
    await redis.set(k.ok(salonId, clientId), "1", "EX", VERIFIED_TTL_SECONDS);
    return { verified: true, expires_in: VERIFIED_TTL_SECONDS };
  },

  async status(salonId: string, clientId: string) {
    const required = await isRedemptionOtpRequired(salonId);
    const ttl = required ? await redis.ttl(k.ok(salonId, clientId)) : 0;
    return { required, verified: !required || ttl > 0, expires_in: ttl > 0 ? ttl : 0 };
  },

  // The enforcement point. `kinds` = what this action actually redeems. No-op
  // when none of those has its switch on (packages and memberships are
  // separate switches), or when nothing is being redeemed. Throws 428 when a
  // redemption has no verified window - the frontend answers that by opening
  // the OTP modal.
  async assertVerified(salonId: string, clientId: string | null | undefined, kinds: RedeemKind[]): Promise<void> {
    if (!kinds.length || !clientId) return;
    const cfg = await getRedemptionOtpConfig(salonId);
    if (!kinds.some((kd) => cfg[kd])) return;
    if (await redis.exists(k.ok(salonId, clientId))) return;
    throw new AppError(
      428,
      "Client OTP verification is required to redeem a package or membership",
      "REDEMPTION_OTP_REQUIRED",
    );
  },
};
