// src/modules/utils/otp.util.ts

import crypto from "crypto";

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
