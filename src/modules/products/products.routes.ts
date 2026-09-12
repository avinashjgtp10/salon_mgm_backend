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
const editProducts = requirePermission("edit_products");
// Consumables ARE products (product_type consumable/both), and Warehouse's
// Product Inventory page's Edit/Delete row actions also call these same
// PATCH/DELETE routes — both Warehouse sections' dedicated permissions are
// OR'd in here as alternatives rather than duplicating separate endpoints.
// A staff member granted ONLY add_consumable/edit_consumable/edit_product/
// delete_product (without the broader Catalog create_products/edit_products/
// delete_products) can still use those specific Warehouse actions.
const createProductsOrConsumable = requireAnyPermission(["create_products", "add_consumable"]);
const editProductsOrConsumable = requireAnyPermission(["edit_products", "edit_consumable", "activate_deactivate_consumable", "edit_product"]);
const deleteProductsOrInventory = requireAnyPermission(["delete_products", "delete_product"]);
// Import/Export Products are their own dedicated permissions (Products
// permissions ticket). import_file/export_csv/excel/pdf (System) are now
// global master gates, not OR'd fallbacks — BOTH the specific permission
// (import_products OR the broader create_products) AND the matching global
// switch are required (Global Download Switches ticket).
const importProducts = [requireAnyPermission(["import_products", "create_products"]), requirePermission("import_file")];
const exportProductsCsv = [requirePermission("download_products_csv"), requirePermission("export_csv")];
const exportProductsExcel = [requirePermission("download_products_excel"), requirePermission("export_excel")];
const exportProductsPdf = [requirePermission("download_products_pdf"), requirePermission("export_pdf")];

// Brands
router.get("/brands", authMiddleware, ownerAdminStaff, viewProducts, brandsController.list);
router.get("/brands/:id", authMiddleware, ownerAdminStaff, viewProducts, brandsController.getById);
router.post("/brands", authMiddleware, ownerAdminStaff, createProducts, validateCreateBrand, brandsController.create);
router.patch("/brands/:id", authMiddleware, ownerAdminStaff, createProducts, validateUpdateBrand, brandsController.update);
router.delete("/brands/:id", authMiddleware, roleMiddleware("salon_owner", "admin"), brandsController.delete);

// Products
router.get("/export/csv", authMiddleware, ownerAdminStaff, viewProducts, ...exportProductsCsv, productsController.exportCSV);
router.get("/export/excel", authMiddleware, ownerAdminStaff, viewProducts, ...exportProductsExcel, productsController.exportExcel);
router.get("/export/pdf", authMiddleware, ownerAdminStaff, viewProducts, ...exportProductsPdf, productsController.exportPDF);
router.post("/import", authMiddleware, ownerAdminStaff, ...importProducts, importUpload.single("file"), productsController.importProducts);

router.get("/", authMiddleware, ownerAdminStaff, viewProducts, validateListQuery, productsController.list);
router.post("/search", authMiddleware, ownerAdminStaff, viewProducts, validateSearchBody, productsController.search);
router.get("/:id", authMiddleware, ownerAdminStaff, viewProducts, productsController.getById);
router.post("/", authMiddleware, ownerAdminStaff, createProductsOrConsumable, uploadMiddleware.array("photos", 5), validateCreateProduct, productsController.create);
router.patch("/:id", authMiddleware, ownerAdminStaff, editProductsOrConsumable, validateUpdateProduct, productsController.update);
router.delete("/:id", authMiddleware, ownerAdminStaff, deleteProductsOrInventory, productsController.delete);

// Product Photos
router.post("/:id/photos", authMiddleware, ownerAdminStaff, editProducts, uploadMiddleware.array("photos", 5), productsController.uploadPhotos);
router.put("/:id/photos/reorder", authMiddleware, ownerAdminStaff, editProducts, validateReorderPhotos, productsController.reorderPhotos);
router.delete("/:id/photos/:photoId", authMiddleware, ownerAdminStaff, editProducts, productsController.deletePhoto);

export default router;
