import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { clientPackagesController } from "./client-packages.controller";
import {
  validateCreateClientPackage,
  validateCompleteSession,
} from "./client-packages.validator";

const router = Router();
const auth = [authMiddleware, requireSalon];

router.get("/",      ...auth, clientPackagesController.list);
router.post("/",     ...auth, validateCreateClientPackage, clientPackagesController.create);
router.get("/:id",    ...auth, clientPackagesController.getById);
router.patch("/:id",  ...auth, clientPackagesController.update);
router.delete("/:id", ...auth, clientPackagesController.delete);
router.post("/:id/sessions/complete", ...auth, validateCompleteSession, clientPackagesController.completeSession);

export default router;
