"use strict";
// src/modules/auth/auth.routes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const rate_limit_middleware_1 = require("../../middleware/rate-limit.middleware");
const router = (0, express_1.Router)();
/**
 * Auth routes
 * Base: /api/v1/auth
 */
router.post("/register", auth_controller_1.authController.register);
router.post("/login", rate_limit_middleware_1.loginRateLimitCheck, auth_controller_1.authController.login);
router.post("/refresh", auth_controller_1.authController.refresh);
router.post("/logout", auth_controller_1.authController.logout);
// Email OTP
router.post("/send-email-otp", auth_controller_1.authController.sendEmailOtp);
router.post("/verify-email-otp", auth_controller_1.authController.verifyEmailOtp);
// Exotel Phone OTP
router.post("/send-phone-otp-exotel", auth_controller_1.authController.sendPhoneOtpExotel);
router.post("/verify-phone-otp-exotel", auth_controller_1.authController.verifyPhoneOtpExotel);
// Google OAuth
router.get("/google/start", auth_controller_1.authController.googleStart);
router.get("/google/callback", auth_controller_1.authController.googleCallback);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map