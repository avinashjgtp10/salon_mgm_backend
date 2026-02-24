import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { servicesController } from "./services.controller";
import {
  validateCreateCategory,
  validateCreateService,
  validateUpdateCategory,
  validateUpdateService,
} from "./services.validator";

const router = Router();

// Categories
router.post(
  "/salons/:salonId/categories",
  authMiddleware,
  roleMiddleware("salon_owner", "admin"),
  validateCreateCategory,
  servicesController.createCategory
);

router.get(
  "/salons/:salonId/categories",
  authMiddleware,
  servicesController.listCategories
);

router.patch(
  "/categories/:id",
  authMiddleware,
  roleMiddleware("salon_owner", "admin"),
  validateUpdateCategory,
  servicesController.updateCategory
);

router.delete(
  "/categories/:id",
  authMiddleware,
  roleMiddleware("salon_owner", "admin"),
  servicesController.deleteCategory
);

// Services
router.post(
  "/salons/:salonId/services",
  authMiddleware,
  roleMiddleware("salon_owner", "admin"),
  validateCreateService,
  servicesController.createService
);

router.get(
  "/salons/:salonId/services",
  authMiddleware,
  servicesController.listServices
);

router.get(
  "/services/:id",
  authMiddleware,
  servicesController.getServiceById
);

router.patch(
  "/services/:id",
  authMiddleware,
  roleMiddleware("salon_owner", "admin"),
  validateUpdateService,
  servicesController.updateService
);

router.delete(
  "/services/:id",
  authMiddleware,
  roleMiddleware("salon_owner", "admin"),
  servicesController.deleteService
);

// Staff ↔ Services mapping
router.post(
  "/staff/:staffId/services/:serviceId",
  authMiddleware,
  roleMiddleware("salon_owner", "admin"),
  servicesController.assignStaffService
);

router.delete(
  "/staff/:staffId/services/:serviceId",
  authMiddleware,
  roleMiddleware("salon_owner", "admin"),
  servicesController.unassignStaffService
);

router.get(
  "/staff/:staffId/services",
  authMiddleware,
  servicesController.listStaffServices
);

export default router;
