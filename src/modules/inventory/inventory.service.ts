import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import {
    suppliersRepository,
    stockMovementsRepository,
    stocktakesRepository,
    stockTakeRepository,
} from "./inventory.repository";
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
