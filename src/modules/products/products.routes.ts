import { Router } from "express";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { productsController, brandsController } from "./products.controller";
import {
    validateCreateProduct,
    validateUpdateProduct,
    validateCreateBrand,
    validateUpdateBrand,
    validateReorderPhotos,
} from "./products.validator";

const router = Router();

// Brands
router.get("/brands", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), brandsController.list);
router.get("/brands/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), brandsController.getById);
router.post("/brands", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateCreateBrand, brandsController.create);
router.patch("/brands/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateUpdateBrand, brandsController.update);
router.delete("/brands/:id", authMiddleware, roleMiddleware("salon_owner", "admin"), brandsController.delete);

// Products
router.get("/export/csv", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), productsController.exportCSV);
router.get("/export/excel", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), productsController.exportExcel);
router.get("/export/pdf", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), productsController.exportPDF);

router.get("/", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), productsController.list);
router.get("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), productsController.getById);
router.post("/", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), uploadMiddleware.array("photos", 5), validateCreateProduct, productsController.create);
router.patch("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateUpdateProduct, productsController.update);
router.delete("/:id", authMiddleware, roleMiddleware("salon_owner", "admin"), productsController.delete);

// Product Photos
router.post("/:id/photos", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), uploadMiddleware.array("photos", 5), productsController.uploadPhotos);
router.put("/:id/photos/reorder", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateReorderPhotos, productsController.reorderPhotos);
router.delete("/:id/photos/:photoId", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), productsController.deletePhoto);

export default router;
