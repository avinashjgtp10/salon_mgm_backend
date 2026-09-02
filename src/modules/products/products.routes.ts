import { Router } from "express";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import { importUpload } from "./products.upload";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { productsController, brandsController } from "./products.controller";
import {
    validateCreateProduct,
    validateUpdateProduct,
    validateCreateBrand,
    validateUpdateBrand,
    validateReorderPhotos,
    validateListQuery,
    validateSearchBody,
} from "./products.validator";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
// Quick Sale and Calendar both need to read the product catalog to build a
// sale/appointment, even for staff who weren't separately granted Catalog
// view permissions — so this passes if they can view products OR sell OR
// manage the calendar.
const viewProducts = requireAnyPermission(["view_products", "create_sales", "manage_calendar"]);
const createProducts = requirePermission("create_products");

// Brands
router.get("/brands", authMiddleware, ownerAdminStaff, viewProducts, brandsController.list);
router.get("/brands/:id", authMiddleware, ownerAdminStaff, viewProducts, brandsController.getById);
router.post("/brands", authMiddleware, ownerAdminStaff, createProducts, validateCreateBrand, brandsController.create);
router.patch("/brands/:id", authMiddleware, ownerAdminStaff, createProducts, validateUpdateBrand, brandsController.update);
router.delete("/brands/:id", authMiddleware, roleMiddleware("salon_owner", "admin"), brandsController.delete);

// Products
router.get("/export/csv", authMiddleware, ownerAdminStaff, viewProducts, productsController.exportCSV);
router.get("/export/excel", authMiddleware, ownerAdminStaff, viewProducts, productsController.exportExcel);
router.get("/export/pdf", authMiddleware, ownerAdminStaff, viewProducts, productsController.exportPDF);
router.post("/import", authMiddleware, ownerAdminStaff, createProducts, importUpload.single("file"), productsController.importProducts);

router.get("/", authMiddleware, ownerAdminStaff, viewProducts, validateListQuery, productsController.list);
router.post("/search", authMiddleware, ownerAdminStaff, viewProducts, validateSearchBody, productsController.search);
router.get("/:id", authMiddleware, ownerAdminStaff, viewProducts, productsController.getById);
router.post("/", authMiddleware, ownerAdminStaff, createProducts, uploadMiddleware.array("photos", 5), validateCreateProduct, productsController.create);
router.patch("/:id", authMiddleware, ownerAdminStaff, createProducts, validateUpdateProduct, productsController.update);
router.delete("/:id", authMiddleware, roleMiddleware("salon_owner", "admin"), productsController.delete);

// Product Photos
router.post("/:id/photos", authMiddleware, ownerAdminStaff, createProducts, uploadMiddleware.array("photos", 5), productsController.uploadPhotos);
router.put("/:id/photos/reorder", authMiddleware, ownerAdminStaff, createProducts, validateReorderPhotos, productsController.reorderPhotos);
router.delete("/:id/photos/:photoId", authMiddleware, ownerAdminStaff, createProducts, productsController.deletePhoto);

export default router;
