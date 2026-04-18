"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const auth_service_1 = require("./auth.service");
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const rate_limit_middleware_1 = require("../../middleware/rate-limit.middleware");
const logger_1 = __importDefault(require("../../config/logger"));
const auth_validator_1 = require("./auth.validator");
function redirectToFrontend(res, accessToken, refreshToken, isOnboardingComplete, returnTo) {
    const frontendUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:5173";
    const base = new URL(frontendUrl);
    base.pathname = "/oauth/success";
    base.searchParams.set("token", accessToken);
    base.searchParams.set("refreshToken", refreshToken);
    base.searchParams.set("isOnboardingComplete", String(isOnboardingComplete));
    if (returnTo)
        base.searchParams.set("returnTo", returnTo);
    res.redirect(base.toString());
}
exports.authController = {
    // ================= REGISTER =================
    async register(req, res, next) {
        try {
            const body = req.body;
            logger_1.default.info("Register request received", {
                email: body?.email,
                ip: req.ip,
            });
            // ✅ Validate required fields (NEW STRUCTURE)
            if (!body?.email || !body?.password || !body?.fullName) {
                logger_1.default.warn("Register validation failed", { body });
                throw new error_middleware_1.AppError(400, "Missing required fields", "VALIDATION_ERROR");
            }
            // ✅ Terms required
            if (body?.terms !== true) {
                throw new error_middleware_1.AppError(400, "Terms must be accepted", "TERMS_NOT_ACCEPTED");
            }
            const user = await auth_service_1.authService.register(body);
            logger_1.default.info("User registered successfully", { email: body.email });
            return (0, response_util_1.sendSuccess)(res, 201, user, "User registered successfully");
        }
        catch (error) {
            logger_1.default.error("Register error", { error });
            return next(error);
        }
    },
    // ================= LOGIN =================
    async login(req, res, next) {
        const email = String(req.body?.email || "")
            .toLowerCase()
            .trim();
        const password = String(req.body?.password || "");
        const ip = String(req.ip || "");
        try {
            logger_1.default.info("Login attempt", { email, ip });
            if (!email || !password) {
                logger_1.default.warn("Login validation failed", { email });
                throw new error_middleware_1.AppError(400, "Email and password required", "VALIDATION_ERROR");
            }
            const data = await auth_service_1.authService.login({ email, password });
            await (0, rate_limit_middleware_1.resetLoginFails)(email, ip);
            logger_1.default.info("Login successful", { email, ip });
            return (0, response_util_1.sendSuccess)(res, 200, data, "Login successful");
        }
        catch (error) {
            // ✅ Rate limit handling
            if (error instanceof error_middleware_1.AppError &&
                error.code === "INVALID_CREDENTIALS") {
                logger_1.default.warn("Invalid login credentials", { email, ip });
                try {
                    const r = await (0, rate_limit_middleware_1.recordLoginFail)(email, ip);
                    const left = Math.max(0, 3 - r.consumedPoints);
                    return next(new error_middleware_1.AppError(401, `Invalid credentials. Attempts left: ${left}`, "INVALID_CREDENTIALS"));
                }
                catch (e) {
                    if (e?.msBeforeNext) {
                        logger_1.default.warn("Login rate limit exceeded", { email, ip });
                        return next(new error_middleware_1.AppError(429, `Too many failed attempts. Try again in ${Math.ceil(e.msBeforeNext / 1000)} seconds.`, "RATE_LIMIT"));
                    }
                }
            }
            logger_1.default.error("Login error", { error, email, ip });
            return next(error);
        }
    },
    // ================= REFRESH TOKEN =================
    async refresh(req, res, next) {
        try {
            const refreshToken = String(req.body?.refreshToken || "");
            logger_1.default.info("Token refresh request", { ip: req.ip });
            if (!refreshToken) {
                throw new error_middleware_1.AppError(400, "refreshToken required", "VALIDATION_ERROR");
            }
            const data = await auth_service_1.authService.refresh(refreshToken);
            logger_1.default.info("Token refreshed successfully");
            return (0, response_util_1.sendSuccess)(res, 200, data, "Token refreshed successfully");
        }
        catch (error) {
            logger_1.default.error("Refresh token error", { error });
            return next(error);
        }
    },
    // ================= LOGOUT =================
    async logout(req, res, next) {
        try {
            const refreshToken = String(req.body?.refreshToken || "");
            logger_1.default.info("Logout request received", { ip: req.ip });
            if (!refreshToken) {
                throw new error_middleware_1.AppError(400, "refreshToken required", "VALIDATION_ERROR");
            }
            const data = await auth_service_1.authService.logout(refreshToken);
            logger_1.default.info("User logged out successfully");
            return (0, response_util_1.sendSuccess)(res, 200, data, "Logged out successfully");
        }
        catch (error) {
            logger_1.default.error("Logout error", { error });
            return next(error);
        }
    },
    // ================= EMAIL OTP =================
    async sendEmailOtp(req, res, next) {
        try {
            const email = String(req.body?.email || "").trim().toLowerCase();
            const data = await auth_service_1.authService.sendEmailOtp(email);
            return (0, response_util_1.sendSuccess)(res, 200, data, "OTP sent");
        }
        catch (e) {
            return next(e);
        }
    },
    async verifyEmailOtp(req, res, next) {
        try {
            const email = String(req.body?.email || "").trim().toLowerCase();
            const otp = String(req.body?.otp || "").trim();
            const data = await auth_service_1.authService.verifyEmailOtp(email, otp);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Email verified");
        }
        catch (e) {
            return next(e);
        }
    },
    // ================= FORGOT PASSWORD =================
    async sendPasswordResetOtp(req, res, next) {
        try {
            const email = String(req.body?.email || "").trim().toLowerCase();
            const data = await auth_service_1.authService.forgotPasswordSendOtp(email);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Password reset request processed");
        }
        catch (e) {
            return next(e);
        }
    },
    async verifyPasswordResetOtp(req, res, next) {
        try {
            const email = String(req.body?.email || "").trim().toLowerCase();
            const otp = String(req.body?.otp || "").trim();
            const data = await auth_service_1.authService.forgotPasswordVerifyOtp(email, otp);
            return (0, response_util_1.sendSuccess)(res, 200, data, "OTP verified");
        }
        catch (e) {
            return next(e);
        }
    },
    async resetPassword(req, res, next) {
        try {
            const email = String(req.body?.email || "").trim().toLowerCase();
            const otp = String(req.body?.otp || "").trim();
            const newPassword = String(req.body?.newPassword || "");
            const data = await auth_service_1.authService.resetPassword(email, otp, newPassword);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Password reset successfully");
        }
        catch (e) {
            return next(e);
        }
    },
    // ================= EXOTEL PHONE OTP =================
    async sendPhoneOtpExotel(req, res, next) {
        try {
            const email = String(req.body?.email || "").trim().toLowerCase();
            const phone = String(req.body?.phone || "").trim();
            const data = await auth_service_1.authService.sendPhoneOtpExotel(email, phone);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Phone OTP sent");
        }
        catch (e) {
            return next(e);
        }
    },
    async verifyPhoneOtpExotel(req, res, next) {
        try {
            const email = String(req.body?.email || "").trim().toLowerCase();
            const otp = String(req.body?.otp || "").trim();
            const data = await auth_service_1.authService.verifyPhoneOtpExotel(email, otp);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Phone verified");
        }
        catch (e) {
            return next(e);
        }
    },
    // ================= GOOGLE OAUTH =================
    async googleStart(req, res, next) {
        try {
            const q = auth_validator_1.googleStartQuerySchema.parse(req.query);
            const returnTo = q.returnTo;
            const { codeVerifier, codeChallenge } = auth_service_1.authService.googleMakePkce();
            const state = await auth_service_1.authService.googleCreateState({ codeVerifier, returnTo });
            const url = auth_service_1.authService.googleAuthUrl({ state, codeChallenge });
            return res.redirect(url);
        }
        catch (e) {
            logger_1.default.error("googleStart error", { error: e });
            next(e);
        }
    },
    async googleCallback(req, res, _next) {
        try {
            const code = String(req.query.code || "");
            const state = String(req.query.state || "");
            if (!code || !state) {
                return res.status(400).json({ message: "Missing code/state. Do not open callback directly." });
            }
            // We explicitly skip zod here so we can see real errors 
            // instead of validation errors on direct access
            const st = await auth_service_1.authService.googleConsumeState(state);
            if (!st?.codeVerifier) {
                return res.status(400).json({ message: "Invalid/expired state. Try logging in again." });
            }
            const tokens = await auth_service_1.authService.googleExchangeCode(code, st.codeVerifier);
            const profile = await auth_service_1.authService.googleGetProfile(tokens.access_token);
            const { accessToken, refreshToken, isOnboardingComplete } = await auth_service_1.authService.signInWithGoogle(profile);
            // Redirect to frontend with tokens + onboarding flag in query string
            return redirectToFrontend(res, accessToken, refreshToken, isOnboardingComplete, st.returnTo);
        }
        catch (err) {
            console.error("GOOGLE CALLBACK ERROR:", err?.response?.data || err?.message || err);
            // Send JSON so the browser shows exactly what went wrong
            return res.status(500).json({
                message: "Google callback failed",
                detail: err?.response?.data || err?.message || String(err)
            });
        }
    },
};
//# sourceMappingURL=auth.controller.js.map