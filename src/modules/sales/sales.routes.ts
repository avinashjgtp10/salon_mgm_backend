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
// (Settings permissions ticket — gates opening the section itself) is OR'd
// into EACH of the two checks so either the original AND-pair or the new
// single key alone satisfies both — (import_sales AND import_file) OR
// view_settings_bulk_billing_import, expressed as two chained ORs since
// middleware only AND-chains, not OR-across-pairs.
router.post("/import", authMiddleware, ownerAdminStaff,
    requireAnyPermission(["import_sales", "view_settings_bulk_billing_import"]),
    requireAnyPermission(["import_file", "view_settings_bulk_billing_import"]),
    upload.single("file"), salesController.import);
router.get("/init", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), salesController.getInit);
router.get("/staff/:staffId/items", authMiddleware, ownerAdminStaff, requirePermission("view_sales"), salesController.listItemsByStaff);
router.get("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff", "client"), requirePermission("view_sales"), salesController.getById);
router.patch("/:id", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateUpdateSale, salesController.update);
router.post("/:id/checkout", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateCheckoutSale, salesController.checkout);
router.delete("/:id", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), salesController.delete);

export default router;
