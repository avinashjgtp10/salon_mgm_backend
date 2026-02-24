// src/modules/utils/otp.util.ts

import crypto from "crypto";
import bcrypt from "bcrypt";

/**
 * Generate a secure 6-digit numeric OTP as a string.
 * Example: "483920"
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * (Optional) Validate OTP format (6 digits).
 */
export function isValidOtp(otp: string): boolean {
  return /^\d{6}$/.test(String(otp || "").trim());
}

/**
 * Hash an OTP using bcrypt before storing in DB.
 */
export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}

/**
 * Compare a plain OTP against a bcrypt hash.
 */
export async function compareOtp(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}

/**
 * Returns an expiry Date N minutes from now.
 */
export function otpExpiry(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}
