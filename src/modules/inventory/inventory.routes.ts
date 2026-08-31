import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import {
    suppliersController,
    stockMovementsController,
    stocktakesController,
    stockTakeController,
    stockReconciliationController,
    consumableUsageController,
} from "./inventory.controller";
import { consumableInventoryController } from "./consumable-inventory.controller";
import { productInventoryController } from "./product-inventory.controller";
import { purchasesController } from "./purchases.controller";
import { supplierPaymentsController } from "./supplier-payments.controller";
import { ordersController } from "./orders.controller";
import { productAuditController } from "./product-audit.controller";
import {
    validateCreateSupplier,
    validateUpdateSupplier,
    validateCreateStockMovement,
    validateStockTake,
} from "./inventory.validator";
import { validateCreatePurchase } from "./purchases.validator";
import { validateCreateSupplierPayment } from "./supplier-payments.validator";
import { validateCreateOrder, validateReceiveOrder } from "./orders.validator";
import {
    validateCreateProductAudit,
    validateAddAuditItems,
    validateUpdateAuditItem,
    validateRejectAudit,
    validateApproveAudit,
} from "./product-audit.validator";

const router = Router();
const viewInventory = requirePermission("view_inventory");
const stockAdjustment = requirePermission("stock_adjustment");
const manageInventory = requirePermission("manage_inventory");

// ─── Suppliers ────────────────────────────────────────────────────────────────

router.post(
    "/suppliers",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateCreateSupplier,
    suppliersController.create
);

router.get(
    "/suppliers",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    suppliersController.list
);

router.get(
    "/suppliers/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    suppliersController.getById
);

router.patch(
    "/suppliers/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateUpdateSupplier,
    suppliersController.update
);

router.delete(
    "/suppliers/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    suppliersController.delete
);

// Payouts are a money-movement action, so restricted to owner/admin like
// supplier create/update/delete — not opened up to staff via viewInventory.
router.post(
    "/suppliers/:id/payments",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateCreateSupplierPayment,
    supplierPaymentsController.create
);

router.get(
    "/suppliers/:id/payments",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    supplierPaymentsController.list
);

// ─── Product Inventory (retail stock) ─────────────────────────────────────────
// Registered ahead of the generic /stock-movements routes so these more
// specific paths are matched first.

router.get(
    "/product-inventory",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    productInventoryController.list
);

router.get(
    "/product-inventory/filter-options",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    productInventoryController.filterOptions
);

router.get(
    "/product-inventory/history",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    productInventoryController.history
);

// Adding stock is a stock adjustment, so it sits behind that permission
// rather than plain view access.
router.post(
    "/product-inventory/:id/stock-in",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    stockAdjustment,
    productInventoryController.stockIn
);

// ─── Purchases (supplier deliveries — multi-product, adds stock) ─────────────
// Registered ahead of /stock-movements for the same "more specific first"
// reason as the block above. A Purchase adds stock exactly like Add Stock
// does, so it sits behind the same stock_adjustment permission, not
// manage_inventory — a staff member who can Add Stock must also be able to
// record a Purchase.
router.post(
    "/product-inventory/purchases",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    stockAdjustment,
    validateCreatePurchase,
    purchasesController.create
);

router.get(
    "/product-inventory/purchases",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    purchasesController.list
);

router.get(
    "/product-inventory/purchases/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    purchasesController.getById
);

// ─── Orders (purchase orders — receiving against one links to Purchases) ───
// Registered ahead of /stock-movements for the same "more specific first"
// reason as Purchases above.

// Signature upload/gallery must be registered BEFORE /orders/:id or Express
// would match "upload-signature"/"signatures" as the :id param.
router.post(
    "/orders/upload-signature",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    uploadMiddleware.single("signature"),
    ordersController.uploadSignature
);

router.get(
    "/orders/signatures",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    ordersController.listSignatures
);

router.post(
    "/orders",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    validateCreateOrder,
    ordersController.create
);

router.get(
    "/orders",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    ordersController.list
);

router.get(
    "/orders/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    ordersController.getById
);

router.post(
    "/orders/:id/receive",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    validateReceiveOrder,
    ordersController.receive
);

router.post(
    "/orders/:id/cancel",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    ordersController.cancel
);

// ─── Stock Movements ──────────────────────────────────────────────────────────

router.post(
    "/stock-movements",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    stockAdjustment,
    validateCreateStockMovement,
    stockMovementsController.create
);

router.get(
    "/stock-movements",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    stockMovementsController.list
);

router.get(
    "/stock-movements/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    stockMovementsController.getById
);

// ─── Stock Takes (Events) ─────────────────────────────────────────────────────

router.post(
    "/stock-takes",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    stocktakesController.create
);

router.get(
    "/stock-takes",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    stocktakesController.list
);

router.get(
    "/stock-takes/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    stocktakesController.getById
);

router.delete(
    "/stock-takes/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    stocktakesController.delete
);

// ─── Stock Take (Processing) ──────────────────────────────────────────────────

router.post(
    "/stock-take",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateStockTake,
    stockTakeController.process
);

// ─── Stock Reconciliation ─────────────────────────────────────────────────────
// Read-only now — its editable "Update All"/per-row save screen was replaced
// by Consumable Inventory's Adjust Stock action (see below). This GET is kept
// only because the Consumable Usage report still reads it for back-bar
// consumption totals; the old save endpoints had no remaining caller and were
// removed.

// GET  /inventory/stock-reconciliation?branch_id=&search=&category_id=
router.get(
    "/stock-reconciliation",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    stockReconciliationController.list
);

// ─── Consumable Inventory (dedicated page — replaces Stock Reconciliation's
// consumable-facing role) ───────────────────────────────────────────────────

// GET /inventory/consumables?search=&category_id=&brand_id=&supplier_id=&status=&unit=&service_id=&sort_by=&page=&limit=
router.get(
    "/consumables",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    consumableInventoryController.list
);

// GET /inventory/consumables/kpis
router.get(
    "/consumables/kpis",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    consumableInventoryController.kpis
);

// GET /inventory/consumables/dashboard?search=&category_id=&...&page=&limit=
// Combined list + KPIs in one call — same filters as GET /consumables above.
// Must be registered BEFORE /consumables/:id or Express would match
// "dashboard" as the :id param.
router.get(
    "/consumables/dashboard",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    consumableInventoryController.dashboard
);

// GET /inventory/consumables/usage-history?product_id=&service_id=&direction=&from=&to=&page=&limit=
// Must be registered BEFORE /consumables/:id or Express would match
// "usage-history" as the :id param.
router.get(
    "/consumables/usage-history",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    consumableInventoryController.usageHistory
);

// GET /inventory/consumables/:id
router.get(
    "/consumables/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    consumableInventoryController.getById
);

// POST /inventory/consumables/:id/adjust
router.post(
    "/consumables/:id/adjust",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    stockAdjustment,
    consumableInventoryController.adjustStock
);

// GET /inventory/consumables/:id/assigned-services — thin Service/Usage list
// for the table's "Assigned Services" click-popup (see Consumable Inventory redesign).
router.get(
    "/consumables/:id/assigned-services",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    consumableInventoryController.assignedServices
);

// GET/PUT /inventory/consumables/:id/unit-conversions — named-unit conversion
// factors (e.g. "Bottle" = 1000 ml) shown in the side panel and entered via
// the Add/Edit Consumable form.
router.get(
    "/consumables/:id/unit-conversions",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    consumableInventoryController.getUnitConversions
);
router.put(
    "/consumables/:id/unit-conversions",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    stockAdjustment,
    consumableInventoryController.replaceUnitConversions
);

// ─── Product Audit (mock-adjacent workflow — read-only against real stock;
// see product-audit.repository.ts) ────────────────────────────────────────────

router.post(
    "/product-audits",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    validateCreateProductAudit,
    productAuditController.create
);

router.get(
    "/product-audits",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    productAuditController.list
);

router.get(
    "/product-audits/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    productAuditController.getById
);

router.delete(
    "/product-audits/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    productAuditController.delete
);

router.post(
    "/product-audits/:id/items",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    validateAddAuditItems,
    productAuditController.addItems
);

router.delete(
    "/product-audits/:id/items/:itemId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    productAuditController.removeItem
);

router.patch(
    "/product-audits/:id/items/:itemId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    validateUpdateAuditItem,
    productAuditController.updateItem
);

router.post(
    "/product-audits/:id/submit",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    productAuditController.submitForReview
);

// Approve/reject are review actions — restricted to owner/admin, unlike the
// count-entry endpoints above which staff can also perform.
router.post(
    "/product-audits/:id/approve",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateApproveAudit,
    productAuditController.approve
);

router.post(
    "/product-audits/:id/reject",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateRejectAudit,
    productAuditController.reject
);

router.post(
    "/product-audits/:id/reopen",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    productAuditController.reopen
);

// ─── Consumable Usage (from Calendar appointments) ────────────────────────────

// POST /inventory/consumable-usage
router.post(
    "/consumable-usage",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    manageInventory,
    consumableUsageController.save
);

export default router;
