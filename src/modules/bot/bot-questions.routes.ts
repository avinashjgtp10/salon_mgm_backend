import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { botQuestionsController } from "./bot-questions.controller";

const router = Router();

// Salon-facing: only the logged-in user's own replies (always scoped by user + salon from the JWT).
router.get("/my-replies", authMiddleware, botQuestionsController.myReplies);
router.patch("/:id/read", authMiddleware, botQuestionsController.markReplyRead);

// Super Admin only — Chatbot > Question History.
router.get("/", authMiddleware, superAdminMiddleware, botQuestionsController.list);
router.get("/frequent", authMiddleware, superAdminMiddleware, botQuestionsController.mostFrequent);
router.get("/stats", authMiddleware, superAdminMiddleware, botQuestionsController.stats);
router.post("/:id/answer", authMiddleware, superAdminMiddleware, botQuestionsController.answer);
router.post("/:id/reply", authMiddleware, superAdminMiddleware, botQuestionsController.reply);

export default router;
