import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import {
    suppliersController,
    stockMovementsController,
    stocktakesController,
    stockTakeController,
    stockReconciliationController,
    consumableUsageController,
} from "./inventory.controller";
import { consumableInventoryController } from "./consumable-inventory.controller";
import {
    validateCreateSupplier,
    validateUpdateSupplier,
    validateCreateStockMovement,
    validateStockTake,
} from "./inventory.validator";

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

// GET  /inventory/stock-reconciliation?branch_id=&search=&category_id=
router.get(
    "/stock-reconciliation",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    viewInventory,
    stockReconciliationController.list
);

// POST /inventory/stock-reconciliation  (batch save — Update All)
router.post(
    "/stock-reconciliation",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    stockReconciliationController.saveAll
);

// PATCH /inventory/stock-reconciliation/:product_id  (single row save)
router.patch(
    "/stock-reconciliation/:product_id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    stockReconciliationController.saveRow
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
