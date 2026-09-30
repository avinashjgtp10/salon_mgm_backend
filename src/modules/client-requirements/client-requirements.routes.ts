import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { clientRequirementsController } from "./client-requirements.controller";

const router = Router();

// ── Super admin only — Super Admin creates and manages requirements on the
// salon's behalf (no salon-facing self-submission) ────────────────────────
router.post("/",                  authMiddleware, superAdminMiddleware, clientRequirementsController.submit);
router.get("/stats",              authMiddleware, superAdminMiddleware, clientRequirementsController.getStats);
router.get("/developers",         authMiddleware, superAdminMiddleware, clientRequirementsController.listDevelopers);

// ── Manage Team (dev/ops super_admin accounts) ──────────────────────────────
router.get("/team",               authMiddleware, superAdminMiddleware, clientRequirementsController.listAllDevelopers);
router.post("/team",              authMiddleware, superAdminMiddleware, clientRequirementsController.createDeveloper);
router.patch("/team/:id/status",  authMiddleware, superAdminMiddleware, clientRequirementsController.setDeveloperStatus);

router.get("/",                   authMiddleware, superAdminMiddleware, clientRequirementsController.getAll);
router.get("/:id",                authMiddleware, superAdminMiddleware, clientRequirementsController.getById);
router.patch("/:id/assign",       authMiddleware, superAdminMiddleware, clientRequirementsController.assign);
router.patch("/:id/status",       authMiddleware, superAdminMiddleware, clientRequirementsController.changeStatus);
router.post("/:id/updates",       authMiddleware, superAdminMiddleware, clientRequirementsController.addUpdate);

export default router;
