import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireAnyPermission } from "../../middleware/permission.middleware";
import { categoriesController } from "./categories.controller";
import { validateCreateCategory, validateUpdateCategory } from "./categories.validator";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
// Quick Sale and Calendar both need to read service categories to build a
// sale/appointment, even for staff who weren't separately granted Catalog view.
const viewServices = requireAnyPermission(["view_services", "create_sales", "manage_calendar"]);
// "Manage Categories" is its own dedicated permission now (see the Service
// Menu permissions ticket) — OR'd with edit_services so existing grants that
// only ever set edit_services keep working unchanged. This same endpoint is
// also used for Product categories (ProductFormPage's "+ Add a category"),
// out of scope for this ticket — manage_categories covers both since
// there's no way to distinguish category `type` at the middleware level.
const manageCategories = requireAnyPermission(["manage_categories", "edit_services"]);

/**
 * Categories routes
 * Base: /api/v1/categories
 */
router.post("/", authMiddleware, ownerAdminStaff, manageCategories, validateCreateCategory, categoriesController.create);
router.get("/", authMiddleware, ownerAdminStaff, viewServices, categoriesController.list);
router.get("/:id", authMiddleware, ownerAdminStaff, viewServices, categoriesController.getById);
router.patch("/:id", authMiddleware, ownerAdminStaff, manageCategories, validateUpdateCategory, categoriesController.update);
router.delete("/:id", authMiddleware, ownerAdminStaff, manageCategories, categoriesController.remove);

export default router;
