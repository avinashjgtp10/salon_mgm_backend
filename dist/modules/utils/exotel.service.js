"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exotelSendSmsOtp = exotelSendSmsOtp;
exports.exotelVerifySmsOtp = exotelVerifySmsOtp;
const axios_1 = __importDefault(require("axios"));
function assertExotelEnv() {
    if (!process.env.EXOTEL_ACCOUNT_SID)
        throw new Error("EXOTEL_ACCOUNT_SID missing");
    if (!process.env.EXOTEL_SMS_APP_ID)
        throw new Error("EXOTEL_SMS_APP_ID missing");
    if (!process.env.EXOTEL_SMS_APP_SECRET)
        throw new Error("EXOTEL_SMS_APP_SECRET missing");
}
function exotelAuthHeader() {
    const creds = Buffer.from(`${process.env.EXOTEL_SMS_APP_ID}:${process.env.EXOTEL_SMS_APP_SECRET}`).toString("base64");
    return `Basic ${creds}`;
}
/**
 * Start OTP verification (sends OTP SMS)
 * POST https://exoverify.exotel.com/v2/accounts/{account_sid}/verifications/sms
 * Body: { application_id, phone_number }
 */
async function exotelSendSmsOtp(phoneE164) {
    assertExotelEnv();
    const url = `https://exoverify.exotel.com/v2/accounts/${process.env.EXOTEL_ACCOUNT_SID}/verifications/sms`;
    try {
        const resp = await axios_1.default.post(url, {
            application_id: process.env.EXOTEL_SMS_APP_ID,
            phone_number: phoneE164,
        }, {
            headers: {
                Authorization: exotelAuthHeader(),
                "Content-Type": "application/json",
            },
            timeout: 15000,
        });
        // verification_id is in resp.data.response.data.verification_id (per docs)
        return resp.data;
    }
    catch (err) {
        const axiosErr = err;
        // ⬇️ This prints the FULL Exotel error response body — check your terminal!
        console.error("[Exotel sendOtp] URL:", url);
        console.error("[Exotel sendOtp] Response status:", axiosErr.response?.status);
        console.error("[Exotel sendOtp] Response body:", JSON.stringify(axiosErr.response?.data, null, 2));
        const msg = axiosErr.response?.data?.response?.reason ||
            axiosErr.response?.data?.message ||
            axiosErr.message ||
            "Exotel send OTP failed";
        const status = axiosErr.response?.status || 502;
        throw Object.assign(new Error(msg), { statusCode: status, code: "EXOTEL_ERROR", isAxios: true });
    }
}
/**
 * Verify OTP
 * POST https://exoverify.exotel.com/v2/accounts/{account_sid}/verifications/sms/{verification_id}
 * Body: { OTP: "123456" }
 */
async function exotelVerifySmsOtp(verificationId, otp) {
    assertExotelEnv();
    const url = `https://exoverify.exotel.com/v2/accounts/${process.env.EXOTEL_ACCOUNT_SID}/verifications/sms/${verificationId}`;
    try {
        const resp = await axios_1.default.post(url, { OTP: otp }, {
            headers: {
                Authorization: exotelAuthHeader(),
                "Content-Type": "application/json",
            },
            timeout: 15000,
        });
        return resp.data;
    }
    catch (err) {
        const axiosErr = err;
        // ⬇️ This prints the FULL Exotel error response body — check your terminal!
        console.error("[Exotel verifyOtp] URL:", url);
        console.error("[Exotel verifyOtp] Response status:", axiosErr.response?.status);
        console.error("[Exotel verifyOtp] Response body:", JSON.stringify(axiosErr.response?.data, null, 2));
        const msg = axiosErr.response?.data?.response?.reason ||
            axiosErr.response?.data?.message ||
            axiosErr.message ||
            "Exotel verify OTP failed";
        const status = axiosErr.response?.status || 502;
        throw Object.assign(new Error(msg), { statusCode: status, code: "EXOTEL_ERROR", isAxios: true });
    }
}
//# sourceMappingURL=exotel.service.js.map