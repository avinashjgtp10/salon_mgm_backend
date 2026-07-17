import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { categoriesController } from "./categories.controller";
import { validateCreateCategory, validateUpdateCategory } from "./categories.validator";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
// Quick Sale and Calendar both need to read service categories to build a
// sale/appointment, even for staff who weren't separately granted Catalog view.
const viewServices = requireAnyPermission(["view_services", "create_sales", "manage_calendar"]);
const editServices = requirePermission("edit_services");

/**
 * Categories routes
 * Base: /api/v1/categories
 */
router.post("/", authMiddleware, ownerAdminStaff, editServices, validateCreateCategory, categoriesController.create);
router.get("/", authMiddleware, ownerAdminStaff, viewServices, categoriesController.list);
router.get("/:id", authMiddleware, ownerAdminStaff, viewServices, categoriesController.getById);
router.patch("/:id", authMiddleware, ownerAdminStaff, editServices, validateUpdateCategory, categoriesController.update);
router.delete("/:id", authMiddleware, ownerAdminStaff, editServices, categoriesController.remove);

export default router;
