import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { packageTemplatesController } from "./package-templates.controller";
import { validateCreatePackageTemplate, validateUpdatePackageTemplate } from "./package-templates.validator";

const router = Router();
const auth   = [authMiddleware, requireSalon];

router.get("/",       ...auth, packageTemplatesController.list);
router.post("/",      ...auth, validateCreatePackageTemplate, packageTemplatesController.create);
router.get("/:id",    ...auth, packageTemplatesController.getById);
router.patch("/:id",  ...auth, validateUpdatePackageTemplate, packageTemplatesController.update);
router.delete("/:id", ...auth, packageTemplatesController.delete);

export default router;
