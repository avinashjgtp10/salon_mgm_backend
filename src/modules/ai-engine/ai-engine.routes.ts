import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { aiEngineController } from "./ai-engine.controller";
import { validateChat } from "./ai-engine.validator";
import { aiEngineRateLimiter } from "./ai-engine.middleware";

const router = Router();

router.post(
    "/chat",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    aiEngineRateLimiter,
    validateChat,
    aiEngineController.chat
);

export default router;
