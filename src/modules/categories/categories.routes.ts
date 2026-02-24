import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { categoriesController } from "./categories.controller";
import { validateCreateCategory, validateUpdateCategory } from "./categories.validator";

const router = Router();

/**
 * Categories routes
 * Base: /api/v1/categories
 * JWT only (authMiddleware). No roleMiddleware.
 */
router.post("/", authMiddleware, validateCreateCategory, categoriesController.create);
router.get("/", authMiddleware, categoriesController.list);
router.get("/:id", authMiddleware, categoriesController.getById);
router.patch("/:id", authMiddleware, validateUpdateCategory, categoriesController.update);
router.delete("/:id", authMiddleware, categoriesController.remove);

export default router;
