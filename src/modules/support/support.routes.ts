import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { supportController } from "./support.controller";

const router = Router();

// ── Salon user routes (any authenticated user) ─────────────────────────────
router.post("/",     authMiddleware, supportController.submitTicket);
router.get("/my",    authMiddleware, supportController.getMyTickets);

// ── Super admin routes ──────────────────────────────────────────────────────
router.get("/stats", authMiddleware, superAdminMiddleware, supportController.getStats);
router.get("/",      authMiddleware, superAdminMiddleware, supportController.getAllTickets);
router.patch("/:id/reply",  authMiddleware, superAdminMiddleware, supportController.replyToTicket);
router.patch("/:id/status", authMiddleware, superAdminMiddleware, supportController.updateStatus);

export default router;
