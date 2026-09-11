import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { requirePlanFeature } from "../../middleware/planFeature.middleware";
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
import { stockLedgerController } from "./stock-ledger.controller";
import {
    validateCreateSupplier,
    validateUpdateSupplier,
    validateCreateStockMovement,
    validateStockTake,
} from "./inventory.validator";
import { validateCreatePurchase, validateListPurchases } from "./purchases.validator";
import { validateCreateSupplierPayment } from "./supplier-payments.validator";
import { validateCreateOrder, validateReceiveOrder, validateCorrectReceivedQty } from "./orders.validator";
import {
    validateCreateProductAudit,
    validateAddAuditItems,
    validateUpdateAuditItem,
    validateSubmitAudit,
    validateRejectAudit,
    validateApproveAudit,
} from "./product-audit.validator";
import {
    validateCreateStockLedgerEntry,
    validateUpdateStockLedgerEntry,
} from "./stock-ledger.validator";

const router = Router();
const viewInventory = requirePermission("view_inventory");
const stockAdjustment = requirePermission("stock_adjustment");
const manageInventory = requirePermission("manage_inventory");
// Suppliers now have their own independent action permissions (see the
// Warehouse -> Suppliers permissions ticket) instead of one shared
// manage_suppliers key — View/Add/Edit/Delete/Payout can each be granted or
// withheld on their own.
const viewSuppliers = requirePermission("view_suppliers");
const createSuppliers = requirePermission("create_suppliers");
const editSuppliers = requirePermission("edit_suppliers");
const deleteSuppliers = requirePermission("delete_suppliers");
const supplierPayout = requirePermission("supplier_payout");
// Orders now have their own independent action permissions too (see the
// Warehouse -> Orders permissions ticket) instead of the shared
// view_inventory/manage_inventory pair. Delete Order previously had NO
// permission check at all (role-only, owner/admin) — closed the same way
// as every other zero-gating gap found this session.
// No separate view_order key — access to the Orders list (view_orders)
// implies access to a single order's details too, so the detail route is
// gated by the same permission rather than a redundant second one.
const viewOrders = requirePermission("view_orders");
const createOrder = requirePermission("create_order");
const editOrder = requirePermission("edit_order");
const cancelOrder = requirePermission("cancel_order");
const receiveOrder = requirePermission("receive_order");
// Signature upload is used from both the create and edit order flows.
const createOrEditOrder = requireAnyPermission(["create_order", "edit_order"]);

// Product Inventory (retail) now has its own independent View/Adjust
// Stock/Stock History permissions too (see the Warehouse -> Product
// Inventory ticket). Add/Edit/Delete Product are dedicated keys of their
// own too (products.routes.ts OR's them in as alternatives to Catalog's
// create_products/edit_products/delete_products on the shared /products
// routes).
const viewProductInventory = requirePermission("view_product_inventory");
const adjustProductStock = requirePermission("adjust_product_stock");
const viewProductStockHistory = requirePermission("view_product_stock_history");

// Consumable Inventory now has its own independent View/Adjust Stock/Usage
// permissions too (see the Warehouse -> Consumable Inventory ticket).
// Add/Edit Consumable are handled as OR-alternatives directly on Catalog's
// products.routes.ts (create_products/edit_products), since consumables ARE
// products (product_type consumable/both) — see that file for
// add_consumable/edit_consumable/activate_deactivate_consumable.
const viewConsumableInventory = requirePermission("view_consumable_inventory");
const adjustConsumableStock = requirePermission("adjust_consumable_stock");
const viewConsumableUsage = requirePermission("view_consumable_usage");
// A product with product_type "both" is BOTH a retail product and a
// consumable — ProductFormPage.tsx fetches/saves this consumable detail
// unconditionally whenever product_type is consumable/both, regardless of
// which page (Catalog Products, Warehouse Product Inventory, or Warehouse
// Consumable Inventory) the edit was opened from. Gating these two routes
// on view_consumable_inventory/adjust_consumable_stock alone broke editing
// a "both" product from Product Inventory for a staff member who only has
// the Product Inventory permissions — OR'ing in view/adjust_product_stock
// covers that case too.
const viewConsumableDetailOrProductInventory = requireAnyPermission(["view_consumable_inventory", "view_product_inventory"]);
const adjustConsumableStockOrProductStock = requireAnyPermission(["adjust_consumable_stock", "adjust_product_stock"]);

// Stock Ledger now has its own independent View/Edit/Delete/Stock Adjustment
// permissions too (see the Warehouse -> Stock Ledger ticket), replacing the
// shared view_inventory/manage_inventory/stock_adjustment triple for this
// section specifically (those three keys are still used by stock-movements/
// stock-takes/stock-reconciliation — legacy routes with no nav tab of their
// own anymore, out of scope here). Delete previously had NO staff access at
// all (owner/admin-only role gate) — widened to ownerAdminStaff so
// delete_stock_ledger is actually meaningful to grant.
const viewStockLedger = requirePermission("view_stock_ledger");
const editStockLedger = requirePermission("edit_stock_ledger");
const deleteStockLedger = requirePermission("delete_stock_ledger");
const stockLedgerAdjustment = requirePermission("stock_ledger_adjustment");

// Product Audit now has its own independent View/Create-Perform/Approve
// permissions too (see the Warehouse -> Product Audit ticket), replacing
// the shared view_inventory/manage_inventory pair for this workflow.
// Approve/Reject were previously owner/admin-only with no permission
// check at all — widened to ownerAdminStaff below so approve_product_audit
// is actually meaningful to grant a staff member.
const viewProductAudit = requirePermission("view_product_audit");
const createProductAudit = requirePermission("create_product_audit");
const approveProductAudit = requirePermission("approve_product_audit");

// Every route below still calls authMiddleware itself (kept, rather than
// hoisted into this router.use(), so each route's full middleware chain
// stays readable in place) — but router.use() runs before route handlers
// regardless of where authMiddleware sits inside them, so this needs its
// own authMiddleware here too, ahead of the plan-feature check, or
// req.user wouldn't exist yet when requirePlanFeature reads it. Running
// authMiddleware twice per request (once here, once again inside the
// matched route) is harmless — it just re-verifies the same JWT.
router.use(authMiddleware, requirePlanFeature("inventory"));

// ─── Suppliers ────────────────────────────────────────────────────────────────

router.post(
    "/suppliers",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    createSuppliers,
    validateCreateSupplier,
    suppliersController.create
);

router.get(
    "/suppliers",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewSuppliers,
    suppliersController.list
);

router.post(
    "/suppliers/list",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewSuppliers,
    suppliersController.listPost
);

router.get(
    "/suppliers/filter-options",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewSuppliers,
    suppliersController.listFilterOptions
);

router.get(
    "/suppliers/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewSuppliers,
    suppliersController.getById
);

router.patch(
    "/suppliers/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    editSuppliers,
    validateUpdateSupplier,
    suppliersController.update
);

router.delete(
    "/suppliers/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    deleteSuppliers,
    suppliersController.delete
);

router.post(
    "/suppliers/:id/payments",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    supplierPayout,
    validateCreateSupplierPayment,
    supplierPaymentsController.create
);

router.get(
    "/suppliers/:id/payments",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewSuppliers,
    supplierPaymentsController.list
);

// ─── Product Inventory (retail stock) ─────────────────────────────────────────
// Registered ahead of the generic /stock-movements routes so these more
// specific paths are matched first.

router.get(
    "/product-inventory",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewProductInventory,
    productInventoryController.list
);

router.get(
    "/product-inventory/filter-options",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewProductInventory,
    productInventoryController.filterOptions
);

router.get(
    "/product-inventory/history",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewProductStockHistory,
    productInventoryController.history
);

// Adding stock is a stock adjustment, so it sits behind that permission
// rather than plain view access.
router.post(
    "/product-inventory/:id/stock-in",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    adjustProductStock,
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
    adjustProductStock,
    validateCreatePurchase,
    purchasesController.create
);

router.get(
    "/product-inventory/purchases",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewProductInventory,
    validateListPurchases,
    purchasesController.list
);

router.get(
    "/product-inventory/purchases/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewProductInventory,
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
    createOrEditOrder,
    uploadMiddleware.single("signature"),
    ordersController.uploadSignature
);

router.get(
    "/orders/signatures",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewOrders,
    ordersController.listSignatures
);

router.post(
    "/orders",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    createOrder,
    validateCreateOrder,
    ordersController.create
);

router.get(
    "/orders",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewOrders,
    ordersController.list
);

router.get(
    "/orders/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewOrders,
    ordersController.getById
);

router.post(
    "/orders/:id/receive",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    receiveOrder,
    validateReceiveOrder,
    ordersController.receive
);

// Corrects a mis-entered received_qty after the fact — see
// ordersRepository.correctReceivedQty for what this does/doesn't touch.
router.post(
    "/orders/:id/items/:itemId/correct-received",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    receiveOrder,
    validateCorrectReceivedQty,
    ordersController.correctReceivedQty
);

// Cancel and Delete share one "Delete/Cancel Order" permission per the
// Warehouse -> Orders ticket (presented as a single action there, not two).
// Delete previously had NO permission check at all (role-only, owner/admin)
// — also widened to ownerAdminStaff so cancel_order is actually meaningful
// to grant a staff member for both actions, not just Cancel.
router.post(
    "/orders/:id/cancel",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    cancelOrder,
    ordersController.cancel
);

// POST, not DELETE — see ordersController.delete for why.
router.post(
    "/orders/:id/delete",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    cancelOrder,
    ordersController.delete
);

// POST, not PUT/PATCH — see ordersController.update for why.
router.post(
    "/orders/:id/update",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    editOrder,
    validateCreateOrder,
    ordersController.update
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
    viewConsumableInventory,
    consumableInventoryController.list
);

// GET /inventory/consumables/kpis
router.get(
    "/consumables/kpis",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewConsumableInventory,
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
    viewConsumableInventory,
    consumableInventoryController.dashboard
);

// GET /inventory/consumables/usage-history?product_id=&service_id=&direction=&from=&to=&page=&limit=
// Must be registered BEFORE /consumables/:id or Express would match
// "usage-history" as the :id param.
router.get(
    "/consumables/usage-history",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewConsumableUsage,
    consumableInventoryController.usageHistory
);

// GET /inventory/consumables/:id
router.get(
    "/consumables/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewConsumableDetailOrProductInventory,
    consumableInventoryController.getById
);

// POST /inventory/consumables/:id/adjust
router.post(
    "/consumables/:id/adjust",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    adjustConsumableStock,
    consumableInventoryController.adjustStock
);

// GET /inventory/consumables/:id/assigned-services — thin Service/Usage list
// for the table's "Assigned Services" click-popup (see Consumable Inventory redesign).
router.get(
    "/consumables/:id/assigned-services",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewConsumableInventory,
    consumableInventoryController.assignedServices
);

// GET/PUT /inventory/consumables/:id/unit-conversions — named-unit conversion
// factors (e.g. "Bottle" = 1000 ml) shown in the side panel and entered via
// the Add/Edit Consumable form.
router.get(
    "/consumables/:id/unit-conversions",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewConsumableInventory,
    consumableInventoryController.getUnitConversions
);
router.put(
    "/consumables/:id/unit-conversions",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    adjustConsumableStockOrProductStock,
    consumableInventoryController.replaceUnitConversions
);

// ─── Product Audit (mock-adjacent workflow — read-only against real stock;
// see product-audit.repository.ts) ────────────────────────────────────────────

router.post(
    "/product-audits",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    createProductAudit,
    validateCreateProductAudit,
    productAuditController.create
);

router.get(
    "/product-audits",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewProductAudit,
    productAuditController.list
);

router.get(
    "/product-audits/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewProductAudit,
    productAuditController.getById
);

// Deleting the whole audit record isn't one of the ticketed actions (only
// Create/Perform and Approve are) — left owner/admin-only, unchanged.
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
    createProductAudit,
    validateAddAuditItems,
    productAuditController.addItems
);

router.delete(
    "/product-audits/:id/items/:itemId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    createProductAudit,
    productAuditController.removeItem
);

router.patch(
    "/product-audits/:id/items/:itemId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    createProductAudit,
    validateUpdateAuditItem,
    productAuditController.updateItem
);

router.post(
    "/product-audits/:id/submit",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    createProductAudit,
    validateSubmitAudit,
    productAuditController.submitForReview
);

// Approve/reject are review actions — previously restricted to owner/admin
// with NO permission check at all (a staff member could never review
// regardless of any permission granted). Widened to ownerAdminStaff + a
// dedicated approve_product_audit permission so this is actually delegable
// per the Warehouse -> Product Audit ticket.
router.post(
    "/product-audits/:id/approve",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    approveProductAudit,
    validateApproveAudit,
    productAuditController.approve
);

router.post(
    "/product-audits/:id/reject",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    approveProductAudit,
    validateRejectAudit,
    productAuditController.reject
);

router.post(
    "/product-audits/:id/reopen",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    createProductAudit,
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

// ─── Stock Ledger — full movement history per product, one row per
// transaction with the running balance already applied (see
// stock-ledger.repository.ts / Migration/create_stock_ledger_table.sql) ───────

router.post(
    "/stock-ledger",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    stockLedgerAdjustment,
    validateCreateStockLedgerEntry,
    stockLedgerController.create
);

router.get(
    "/stock-ledger",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewStockLedger,
    stockLedgerController.list
);

// POST /inventory/stock-ledger/list — same as GET /stock-ledger above, but
// filters travel in the JSON body (report-style) instead of the query string.
router.post(
    "/stock-ledger/list",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewStockLedger,
    stockLedgerController.search
);

router.get(
    "/stock-ledger/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewStockLedger,
    stockLedgerController.getById
);

router.get(
    "/stock-ledger/product/:productId/timeline",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewStockLedger,
    stockLedgerController.getTimelineForProduct
);

router.put(
    "/stock-ledger/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    editStockLedger,
    validateUpdateStockLedgerEntry,
    stockLedgerController.update
);

router.delete(
    "/stock-ledger/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    deleteStockLedger,
    stockLedgerController.delete
);

export default router;
