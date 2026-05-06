import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { settingsController } from "./settings.controller";

const router = Router();

router.get("/",      authMiddleware, settingsController.list);
router.get("/:id",   authMiddleware, settingsController.getById);
router.post("/",     authMiddleware, settingsController.create);
router.put("/:id",   authMiddleware, settingsController.update);
router.delete("/:id",authMiddleware, settingsController.remove);

export default router;
