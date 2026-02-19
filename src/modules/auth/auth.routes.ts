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



export default router;
