import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { botQuestionsController } from "./bot-questions.controller";

const router = Router();

// Super Admin only — Chatbot > Question History.
router.get("/", authMiddleware, superAdminMiddleware, botQuestionsController.list);
router.get("/frequent", authMiddleware, superAdminMiddleware, botQuestionsController.mostFrequent);
router.get("/stats", authMiddleware, superAdminMiddleware, botQuestionsController.stats);
router.post("/:id/answer", authMiddleware, superAdminMiddleware, botQuestionsController.answer);

export default router;
