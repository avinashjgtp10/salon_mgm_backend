import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { packageTemplatesController } from "./package-templates.controller";

const router = Router();
const auth   = [authMiddleware, requireSalon];

router.get("/",       ...auth, packageTemplatesController.list);
router.post("/",      ...auth, packageTemplatesController.create);
router.get("/:id",    ...auth, packageTemplatesController.getById);
router.patch("/:id",  ...auth, packageTemplatesController.update);
router.delete("/:id", ...auth, packageTemplatesController.delete);

export default router;
