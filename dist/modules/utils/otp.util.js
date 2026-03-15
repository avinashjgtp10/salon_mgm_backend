"use strict";
// src/modules/utils/otp.util.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOtp = generateOtp;
exports.isValidOtp = isValidOtp;
exports.hashOtp = hashOtp;
exports.compareOtp = compareOtp;
exports.otpExpiry = otpExpiry;
const crypto_1 = __importDefault(require("crypto"));
const bcrypt_1 = __importDefault(require("bcrypt"));
/**
 * Generate a secure 6-digit numeric OTP as a string.
 * Example: "483920"
 */
function generateOtp() {
    return crypto_1.default.randomInt(100000, 1000000).toString();
}
/**
 * (Optional) Validate OTP format (6 digits).
 */
function isValidOtp(otp) {
    return /^\d{6}$/.test(String(otp || "").trim());
}
/**
 * Hash an OTP using bcrypt before storing in DB.
 */
async function hashOtp(otp) {
    return bcrypt_1.default.hash(otp, 10);
}
/**
 * Compare a plain OTP against a bcrypt hash.
 */
async function compareOtp(otp, hash) {
    return bcrypt_1.default.compare(otp, hash);
}
/**
 * Returns an expiry Date N minutes from now.
 */
function otpExpiry(minutes) {
    return new Date(Date.now() + minutes * 60 * 1000);
}
//# sourceMappingURL=otp.util.js.map