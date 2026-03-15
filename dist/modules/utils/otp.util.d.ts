/**
 * Generate a secure 6-digit numeric OTP as a string.
 * Example: "483920"
 */
export declare function generateOtp(): string;
/**
 * (Optional) Validate OTP format (6 digits).
 */
export declare function isValidOtp(otp: string): boolean;
/**
 * Hash an OTP using bcrypt before storing in DB.
 */
export declare function hashOtp(otp: string): Promise<string>;
/**
 * Compare a plain OTP against a bcrypt hash.
 */
export declare function compareOtp(otp: string, hash: string): Promise<boolean>;
/**
 * Returns an expiry Date N minutes from now.
 */
export declare function otpExpiry(minutes: number): Date;
//# sourceMappingURL=otp.util.d.ts.map