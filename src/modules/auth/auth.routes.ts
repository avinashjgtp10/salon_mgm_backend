// src/modules/auth/auth.routes.ts

import { Router } from "express";
import { authController } from "./auth.controller";
import { loginRateLimitCheck } from "../../middleware/rate-limit.middleware";

const router = Router();

/**
 * Auth routes
 * Base: /api/v1/auth
 */
router.post("/register", authController.register);
router.post("/login", loginRateLimitCheck, authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);

// Email OTP
router.post("/send-email-otp", authController.sendEmailOtp);
router.post("/verify-email-otp", authController.verifyEmailOtp);

// Forgot Password
router.post("/forgot-password/send-otp", authController.sendPasswordResetOtp);
router.post("/forgot-password/verify-otp", authController.verifyPasswordResetOtp);
router.post("/forgot-password/reset", authController.resetPassword);

// Exotel Phone OTP
router.post("/send-phone-otp-exotel", authController.sendPhoneOtpExotel);
router.post("/verify-phone-otp-exotel", authController.verifyPhoneOtpExotel);

// Google OAuth
router.get("/google/start", authController.googleStart);
router.get("/google/callback", authController.googleCallback);

export default router;
