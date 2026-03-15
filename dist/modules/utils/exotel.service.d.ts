/**
 * Start OTP verification (sends OTP SMS)
 * POST https://exoverify.exotel.com/v2/accounts/{account_sid}/verifications/sms
 * Body: { application_id, phone_number }
 */
export declare function exotelSendSmsOtp(phoneE164: string): Promise<any>;
/**
 * Verify OTP
 * POST https://exoverify.exotel.com/v2/accounts/{account_sid}/verifications/sms/{verification_id}
 * Body: { OTP: "123456" }
 */
export declare function exotelVerifySmsOtp(verificationId: string, otp: string): Promise<any>;
//# sourceMappingURL=exotel.service.d.ts.map