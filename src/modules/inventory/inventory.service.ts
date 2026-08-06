import { PoolClient } from "pg";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { branchesService } from "../branches/branches.service";
import {
    suppliersRepository,
    stockMovementsRepository,
    stocktakesRepository,
    stockTakeRepository,
    stockReconciliationRepository,
    consumableUsageRepository,
} from "./inventory.repository";
import { inventoryTransactionsRepository } from "./inventory-transactions.repository";
import { AppointmentServiceConsumableRow, InventoryTransactionItem } from "./inventory-transactions.types";
import {
    Supplier,
    CreateSupplierBody,
    UpdateSupplierBody,
    StockMovement,
    CreateStockMovementBody,
    StockTakeBody,
    StockTakeResult,
    ListStockMovementsFilters,
    Stocktake,
    CreateStocktakeBody,
    StocktakeStatus,
    StockReconciliationRow,
    SaveReconciliationBody,
    SaveReconciliationRowBody,
    SaveConsumableUsageBody,
} from "./inventory.types";

// ─── Suppliers ────────────────────────────────────────────────────────────────

export const suppliersService = {
    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
        body: CreateSupplierBody;
    }): Promise<Supplier> {
        const { requesterUserId, requesterRole, salonId, body } = params;
        logger.info("suppliersService.create called", { requesterUserId, requesterRole });
        const created = await suppliersRepository.create(body, salonId);
        logger.info("suppliersService.create success", { supplierId: created.id });
        return created;
    },

    async getById(id: string, salonId: string): Promise<Supplier> {
        const supplier = await suppliersRepository.findById(id, salonId);
        if (!supplier) throw new AppError(404, "Supplier not found", "NOT_FOUND");
        return supplier;
    },

    async listAll(salonId: string): Promise<Supplier[]> {
        return suppliersRepository.listAll(salonId);
    },

    async update(params: {
        supplierId: string;
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
        patch: UpdateSupplierBody;
    }): Promise<Supplier> {
        const { supplierId, requesterUserId, requesterRole, salonId, patch } = params;
        logger.info("suppliersService.update called", { supplierId, requesterUserId, requesterRole });
        const existing = await suppliersRepository.findById(supplierId, salonId);
        if (!existing) throw new AppError(404, "Supplier not found", "NOT_FOUND");
        const updated = await suppliersRepository.update(supplierId, patch, salonId);
        logger.info("suppliersService.update success", { supplierId: updated.id });
        return updated;
    },

    async delete(params: {
        supplierId: string;
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
    }): Promise<void> {
        const { supplierId, requesterUserId, requesterRole, salonId } = params;
        logger.info("suppliersService.delete called", { supplierId, requesterUserId, requesterRole });
        const existing = await suppliersRepository.findById(supplierId, salonId);
        if (!existing) throw new AppError(404, "Supplier not found", "NOT_FOUND");
        await suppliersRepository.delete(supplierId, salonId);
        logger.info("suppliersService.delete success", { supplierId });
    },
};

// ─── Stock Movements ──────────────────────────────────────────────────────────

export const stockMovementsService = {
    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        salonId: string;
        body: CreateStockMovementBody;
    }): Promise<StockMovement> {
        const { requesterUserId, requesterRole, salonId, body } = params;
        logger.info("stockMovementsService.create called", { requesterUserId, requesterRole, productId: body.product_id, movementType: body.movement_type });
        const created = await stockMovementsRepository.create(body, requesterUserId, salonId);
        logger.info("stockMovementsService.create success", { movementId: created.id, movementType: created.movement_type, quantity: created.quantity });
        return created;
    },

    async getById(id: string, salonId: string): Promise<StockMovement> {
        const movement = await stockMovementsRepository.findById(id, salonId);
        if (!movement) throw new AppError(404, "Stock movement not found", "NOT_FOUND");
        return movement;
    },

    async list(filters: ListStockMovementsFilters, salonId: string): Promise<{ data: StockMovement[]; total: number; page: number; limit: number }> {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const { data, total } = await stockMovementsRepository.list({ ...filters, page, limit }, salonId);
        return { data, total, page, limit };
    },
};

// ─── Stock Takes ──────────────────────────────────────────────────────────────

export const stocktakesService = {
    async create(params: { requesterUserId: string; requesterRole?: string; salonId: string; body: CreateStocktakeBody; }): Promise<Stocktake> {
        const { requesterUserId, salonId, body } = params;
        logger.info("stocktakesService.create called", { requesterUserId, branchId: body.branch_id, salonId });
        const created = await stocktakesRepository.create({
            branch_id: body.branch_id, name: body.name || `Stocktake - ${new Date().toLocaleDateString()}`,
            description: body.description, started_by: requesterUserId,
        }, salonId);
        return created;
    },

    async getById(id: string, salonId: string): Promise<Stocktake> {
        const stocktake = await stocktakesRepository.findById(id, salonId);
        if (!stocktake) throw new AppError(404, "Stocktake not found", "NOT_FOUND");
        return stocktake;
    },

    async list(branchId: string, salonId: string): Promise<Stocktake[]> {
        return stocktakesRepository.list(branchId, salonId);
    },

    async updateStatus(id: string, status: StocktakeStatus, salonId: string): Promise<Stocktake> {
        const updated = await stocktakesRepository.updateStatus(id, status, salonId);
        if (!updated) throw new AppError(404, "Stocktake not found", "NOT_FOUND");
        return updated;
    },

    async delete(id: string, salonId: string): Promise<void> {
        logger.info("stocktakesService.delete called", { id, salonId });
        const existing = await stocktakesRepository.findById(id, salonId);
        if (!existing) throw new AppError(404, "Stocktake not found", "NOT_FOUND");
        await stocktakesRepository.delete(id, salonId);
        logger.info("stocktakesService.delete success", { id });
    },
};

// ─── Stock Take ───────────────────────────────────────────────────────────────

export const stockTakeService = {
    async process(params: { requesterUserId: string; requesterRole?: string; salonId: string; body: StockTakeBody; }): Promise<StockTakeResult> {
        const { requesterUserId, requesterRole, salonId, body } = params;
        logger.info("stockTakeService.process called", { requesterUserId, requesterRole, salonId, branchId: body.branch_id, stocktakeId: body.stocktake_id, itemCount: body.items.length });
        const movements = await stockTakeRepository.process({
            stocktake_id: body.stocktake_id, branch_id: body.branch_id, notes: body.notes, items: body.items, created_by: requesterUserId, salonId,
        });
        logger.info("stockTakeService.process success", { processed: body.items.length, movementsCreated: movements.length });
        return { processed: body.items.length, movements };
    },
};

// ─── Stock Reconciliation ─────────────────────────────────────────────────────

export const stockReconciliationService = {
    async list(params: {
        branchId: string;
        salonId: string;
        search?: string;
        categoryId?: string;
    }): Promise<StockReconciliationRow[]> {
        const { branchId, salonId, search, categoryId } = params;
        if (!branchId) throw new AppError(400, "branch_id is required", "VALIDATION_ERROR");
        logger.info("stockReconciliationService.list called", { branchId, salonId });
        return stockReconciliationRepository.list(branchId, salonId, search, categoryId);
    },

    async saveAll(params: {
        requesterUserId: string;
        salonId: string;
        body: SaveReconciliationBody;
    }): Promise<{ processed: number }> {
        const { requesterUserId, salonId, body } = params;
        if (!body.branch_id) throw new AppError(400, "branch_id is required", "VALIDATION_ERROR");
        if (!body.items?.length) throw new AppError(400, "items array is required", "VALIDATION_ERROR");
        logger.info("stockReconciliationService.saveAll called", { branchId: body.branch_id, count: body.items.length });
        const processed = await stockReconciliationRepository.upsertBatch(body.branch_id, salonId, body.items, requesterUserId);
        logger.info("stockReconciliationService.saveAll success", { processed });
        return { processed };
    },

    async saveRow(params: {
        requesterUserId: string;
        salonId: string;
        body: SaveReconciliationRowBody;
    }): Promise<StockReconciliationRow> {
        const { requesterUserId, salonId, body } = params;
        if (!body.branch_id) throw new AppError(400, "branch_id is required", "VALIDATION_ERROR");
        if (!body.product_id) throw new AppError(400, "product_id is required", "VALIDATION_ERROR");
        logger.info("stockReconciliationService.saveRow called", { productId: body.product_id, branchId: body.branch_id });
        const row = await stockReconciliationRepository.upsertRow(body.branch_id, salonId, {
            product_id: body.product_id,
            adjust_stock: body.adjust_stock,
            adjust_consumable: body.adjust_consumable,
            remark: body.remark,
        }, requesterUserId);
        if (!row) throw new AppError(404, "Product not found", "NOT_FOUND");
        logger.info("stockReconciliationService.saveRow success", { productId: body.product_id });
        return row;
    },
};

// ─── Consumable Usage ─────────────────────────────────────────────────────────

export const consumableUsageService = {
    async save(params: {
        requesterUserId: string;
        salonId: string;
        body: SaveConsumableUsageBody;
    }): Promise<{ recorded: number }> {
        const { requesterUserId, salonId, body } = params;
        if (!body.branch_id) throw new AppError(400, "branch_id is required", "VALIDATION_ERROR");
        if (!body.items?.length) throw new AppError(400, "items are required", "VALIDATION_ERROR");
        logger.info("consumableUsageService.save called", { branchId: body.branch_id, count: body.items.length });
        const recorded = await consumableUsageRepository.create(body, salonId, requesterUserId);
        logger.info("consumableUsageService.save success", { recorded });
        return { recorded };
    },
};

// ─── Appointment Consumables ───────────────────────────────────────────────────
// Orchestration only — the transaction/locking/validation logic all lives in
// inventoryTransactionsRepository above. This layer just knows how to turn
// appointment_service_consumables rows into inventory-engine calls.

export const appointmentConsumablesService = {
    // Resolves which branch to attribute a stock movement to when the caller
    // doesn't already have one on hand — mirrors the "main branch, else
    // first branch" heuristic used elsewhere in this codebase (e.g.
    // appointments.service.ts, payments.service.ts's WhatsApp-receipt
    // address lookups). Unlike those cosmetic lookups, THIS one gates
    // whether consumable stock gets deducted at all — going through
    // branchesService.listBranchesBySalon (not the raw repository call)
    // matters here specifically, since it auto-creates a "Main Branch" for
    // a salon that never set one up, instead of returning an empty list and
    // silently skipping every consumable deduction with no error anywhere.
    async resolveBranchId(salonId: string, apptBranchId?: string | null): Promise<string | null> {
        if (apptBranchId) return apptBranchId;
        const branches = await branchesService.listBranchesBySalon(salonId);
        const main = branches.find((b) => b.is_main) ?? branches[0] ?? null;
        return main?.id ?? null;
    },

    // Flattens current-state rows into the generic engine's item shape,
    // using actual_qty (not standard_qty) — that's what actually gets
    // deducted. Zero-qty rows are dropped; there's nothing to move.
    collectServiceRowItems(rows: AppointmentServiceConsumableRow[]): InventoryTransactionItem[] {
        return rows
            .filter((r) => Number(r.actual_qty) > 0)
            .map((r) => ({
                product_id: r.product_id,
                qty: Number(r.actual_qty),
                unit: r.unit ?? undefined,
                service_row_id: r.service_row_id,
                service_id: r.service_id ?? undefined,
            }));
    },

    // First-ever deduction, fired when an appointment transitions to fully
    // paid. Pass txClient when the caller already has an open transaction
    // this must commit or roll back together with (payments.service.ts does,
    // so a payment row is never committed without its matching stock
    // deduction) — omit it when there isn't one (appointments.service.ts's
    // own first-time-paid edge case has no shared transaction to join; see
    // its call site for why that's an accepted, logged-not-silent tradeoff).
    async completeAppointment(
        params: { rows: AppointmentServiceConsumableRow[]; salonId: string; branchId: string; bookingId: string; userId: string },
        txClient?: PoolClient
    ): Promise<void> {
        const items = appointmentConsumablesService.collectServiceRowItems(params.rows);
        if (!items.length) return;
        await inventoryTransactionsRepository.deduct(
            {
                reason: "consumable_usage",
                items,
                salonId: params.salonId,
                branchId: params.branchId,
                referenceType: "appointment_complete",
                referenceId: params.bookingId,
                userId: params.userId,
                // Billing must never be blocked by stock. The consumables were
                // physically used regardless of what inventory claims, so record
                // the usage and let products.amount floor at 0 (the UPDATE uses
                // GREATEST(amount + delta, 0)). A stale/never-reconciled stock
                // figure is an inventory-accuracy problem to fix in Stock
                // Reconciliation — not a reason to refuse the customer's payment.
                allowNegative: true,
            },
            txClient
        );
    },

    // Diffs prior vs new declared usage by (service_row_id, product_id) —
    // never by product_id alone, since one appointment can have two service
    // rows using the same product. Rows dropped entirely from `newRows`
    // (service/consumable removed from the appointment) are treated as a
    // full restore of their prior actual_qty. Pure/no I/O — callers use the
    // result both to pre-validate stock (validateAvailability on toDeduct)
    // and to apply it (applyDelta below).
    computeDelta(
        priorRows: AppointmentServiceConsumableRow[],
        newRows: { service_row_id: string; service_id?: string | null; product_id: string; unit?: string | null; actual_qty: number }[]
    ): { toDeduct: InventoryTransactionItem[]; toRestore: InventoryTransactionItem[] } {
        const key = (r: { service_row_id: string; product_id: string }) => `${r.service_row_id}::${r.product_id}`;
        const priorMap = new Map(priorRows.map((r) => [key(r), r]));
        const newMap = new Map(newRows.map((r) => [key(r), r]));

        const toDeduct: InventoryTransactionItem[] = [];
        const toRestore: InventoryTransactionItem[] = [];

        for (const [k, row] of newMap) {
            const priorQty = Number(priorMap.get(k)?.actual_qty ?? 0);
            const newQty = Number(row.actual_qty);
            const delta = newQty - priorQty;
            const item: InventoryTransactionItem = {
                product_id: row.product_id,
                unit: row.unit ?? undefined,
                service_row_id: row.service_row_id,
                service_id: row.service_id ?? undefined,
                qty: Math.abs(delta),
            };
            if (delta > 0) toDeduct.push(item);
            else if (delta < 0) toRestore.push(item);
        }
        for (const [k, row] of priorMap) {
            if (!newMap.has(k)) {
                toRestore.push({
                    product_id: row.product_id,
                    unit: row.unit ?? undefined,
                    service_row_id: row.service_row_id,
                    service_id: row.service_id ?? undefined,
                    qty: Number(row.actual_qty),
                });
            }
        }
        return { toDeduct, toRestore };
    },

    // Applies a delta already computed by computeDelta(). Not run inside a
    // shared transaction with the appointment row update — each of
    // deduct()/restore() manages its own transaction, so a failure here
    // (e.g. the row-locked re-check inside deduct() finds a shortfall the
    // earlier pre-check missed) throws before any ledger row is written,
    // and the appointment patch that follows in the caller never runs.
    async applyDelta(params: {
        toDeduct: InventoryTransactionItem[];
        toRestore: InventoryTransactionItem[];
        salonId: string;
        branchId: string;
        bookingId: string;
        userId: string;
    }): Promise<void> {
        const base = {
            reason: "consumable_usage" as const,
            salonId: params.salonId,
            branchId: params.branchId,
            referenceType: "appointment_adjustment" as const,
            referenceId: params.bookingId,
            userId: params.userId,
        };
        if (params.toDeduct.length) {
            // Same rationale as completeAppointment above — an edit to an
            // already-paid appointment must not be refused over stock either.
            await inventoryTransactionsRepository.deduct({ ...base, items: params.toDeduct, allowNegative: true });
        }
        if (params.toRestore.length) {
            await inventoryTransactionsRepository.restore({ ...base, items: params.toRestore });
        }
    },
};
