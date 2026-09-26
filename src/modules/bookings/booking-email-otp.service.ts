// ============================================================
// SalonOx — Public booking: client email OTP verification
// ============================================================
//
// The public booking form is unauthenticated, so there's no user account to
// hang verification off. This is deliberately independent of
// auth.service.ts's sendEmailOtp/verifyEmailOtp — that flow looks up
// findUserByEmail and, for an email that happens to match a real account,
// stores the OTP against that account and calls markUserVerified() on it.
// A booking customer typing their email must never mutate a real login
// account as a side effect, so this always uses the Redis-only path and
// never touches the users table.
//
// Shares the same `otp:email:{email}` / `otp:email:verified:{email}` Redis
// key namespace as auth.service.ts's pre-registration flow and
// demo-requests.service.ts's gate check — one email-verified marker, reused
// by whichever public flow asked for it.

import { AppError } from "../../middleware/error.middleware";
import redis from "../../config/redis";
import { generateOtp, hashOtp, compareOtp } from "../utils/otp.util";
import { emailService } from "../utils/email.service";
import logger from "../../config/logger";

const OTP_TTL_SECONDS = 10 * 60;
const VERIFIED_TTL_SECONDS = 30 * 60;

const normalizeEmail = (raw: string) => String(raw || "").trim().toLowerCase();
const otpKey = (email: string) => `otp:email:${email}`;
const verifiedKey = (email: string) => `otp:email:verified:${email}`;

export const bookingEmailOtpService = {
    async sendOtp(emailRaw: string) {
        const email = normalizeEmail(emailRaw);
        if (!email) throw new AppError(400, "Email is required", "VALIDATION_ERROR");

        const otp = generateOtp();
        const otpHash = await hashOtp(otp);
        await redis.set(otpKey(email), otpHash, "EX", OTP_TTL_SECONDS);

        try {
            await emailService.sendOtpEmail(email, otp);
        } catch (err: any) {
            logger.error("[bookingEmailOtpService.sendOtp] Failed to send OTP email", {
                email,
                error: err?.message,
            });
            throw new AppError(500, "Failed to send OTP email. Please try again.", "EMAIL_SEND_FAILED");
        }

        return { message: "OTP sent to email" };
    },

    async verifyOtp(emailRaw: string, otpRaw: string) {
        const email = normalizeEmail(emailRaw);
        const otp = String(otpRaw || "").trim();
        if (!email || !otp) throw new AppError(400, "Email and OTP are required", "VALIDATION_ERROR");

        const storedHash = await redis.get(otpKey(email));
        if (!storedHash) throw new AppError(400, "OTP not found or expired", "OTP_NOT_FOUND");

        const ok = await compareOtp(otp, storedHash);
        if (!ok) throw new AppError(400, "Invalid OTP", "OTP_INVALID");

        await redis.del(otpKey(email));
        await redis.set(verifiedKey(email), "1", "EX", VERIFIED_TTL_SECONDS);

        return { message: "Email verified successfully", success: true };
    },

    /** Used by bookings.service.ts to gate booking creation on a verified email. */
    async isVerified(emailRaw: string): Promise<boolean> {
        const email = normalizeEmail(emailRaw);
        if (!email) return false;
        return (await redis.get(verifiedKey(email))) === "1";
    },
};
