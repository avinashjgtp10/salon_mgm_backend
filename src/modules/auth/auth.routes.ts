import { Router } from "express";
import { authController } from "./auth.controller";
import { loginRateLimitCheck } from "../../middleware/rate-limit.middleware";
const router = Router();

router.post("/register", authController.register);
router.post("/login",    loginRateLimitCheck,  authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);

export default router;
