import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { permissionsController } from "../roles/roles.controller";

const router = Router();

// Read-only reference catalog (key/name/description/module/risk_level/
// dependencies) — any authenticated user can fetch it. It's metadata, not
// an access grant, so it carries no permission check beyond being logged in.
router.get("/", authMiddleware, permissionsController.list);

export default router;
