import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission, requireExportFormatPermission } from "../../middleware/permission.middleware";
import { salesController } from "./sales.controller";
import { upload } from "./sales.upload";
import {
    validateCreateSale, validateUpdateSale, validateCheckoutSale,
} from "./sales.validator";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

router.post("/", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateCreateSale, salesController.create);
router.get("/", authMiddleware, ownerAdminStaff, requirePermission("view_sales"), salesController.list);
router.get("/summary", authMiddleware, ownerAdminStaff, requirePermission("view_sales"), salesController.getDailySummary);
router.get("/export", authMiddleware, ownerAdminStaff, requirePermission("view_sales"), requireExportFormatPermission(["csv", "excel", "pdf"], "csv"), salesController.exportSales);
// Bulk Billing Import — requires BOTH import_sales (its own key, since one
// upload can write thousands of historical financial records at once and has
// a materially larger blast radius than a single staff-entered sale) AND the
// system-wide import_file permission. view_settings_bulk_billing_import
// (Settings permissions ticket — gates opening the section itself) is still
// OR'd into the import_sales check as an alternative entry point, but
// import_file (System) is now a global master gate (Global Download
// Switches ticket) — it must be on unconditionally, with no bypass, or
// nothing imports anywhere regardless of any other key.
router.post("/import", authMiddleware, ownerAdminStaff,
    requireAnyPermission(["import_sales", "view_settings_bulk_billing_import"]),
    requirePermission("import_file"),
    upload.single("file"), salesController.import);
router.get("/init", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), salesController.getInit);
router.get("/staff/:staffId/items", authMiddleware, ownerAdminStaff, requirePermission("view_sales"), salesController.listItemsByStaff);
router.get("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff", "client"), requirePermission("view_sales"), salesController.getById);
router.patch("/:id", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateUpdateSale, salesController.update);
router.post("/:id/checkout", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateCheckoutSale, salesController.checkout);
router.delete("/:id", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), salesController.delete);

export default router;
