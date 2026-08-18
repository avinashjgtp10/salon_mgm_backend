// src/modules/auth/auth.routes.ts

import { Router } from "express";
import { authController } from "./auth.controller";
import { loginRateLimitCheck } from "../../middleware/rate-limit.middleware";
import { authMiddleware } from "../../middleware/auth.middleware";

const router = Router();

/**
 * Auth routes
 * Base: /api/v1/auth
 */
router.post("/register", authController.register);
router.post("/login", loginRateLimitCheck, authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
router.post("/logout-all", authMiddleware, authController.logoutAll);

// Branch switching (Salon Groups — Phase 1)
router.get("/my-salon-group", authMiddleware, authController.getMySalonGroup);
router.post("/switch-salon", authMiddleware, authController.switchSalon);

// Group Admin portal (mini Super-Admin-style panel for a grouped owner)
router.get("/my-group-salons", authMiddleware, authController.getMyGroupSalons);
router.get("/my-group-summary", authMiddleware, authController.getMyGroupSummary);
router.delete("/account", authMiddleware, authController.deleteAccount);

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
