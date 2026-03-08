import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import {
    suppliersRepository,
    stockMovementsRepository,
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
} from "./inventory.types";

// ─── Suppliers ────────────────────────────────────────────────────────────────

export const suppliersService = {
    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateSupplierBody;
    }): Promise<Supplier> {
        const { requesterUserId, requesterRole, body } = params;

        logger.info("suppliersService.create called", {
            requesterUserId,
            requesterRole,
        });

        const created = await suppliersRepository.create(body);

        logger.info("suppliersService.create success", {
            supplierId: created.id,
        });

        return created;
    },

    async getById(id: string): Promise<Supplier> {
        const supplier = await suppliersRepository.findById(id);
        if (!supplier) throw new AppError(404, "Supplier not found", "NOT_FOUND");
        return supplier;
    },

    async listAll(): Promise<Supplier[]> {
        return suppliersRepository.listAll();
    },

    async update(params: {
        supplierId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateSupplierBody;
    }): Promise<Supplier> {
        const { supplierId, requesterUserId, requesterRole, patch } = params;

        logger.info("suppliersService.update called", { supplierId, requesterUserId, requesterRole });

        const existing = await suppliersRepository.findById(supplierId);
        if (!existing) throw new AppError(404, "Supplier not found", "NOT_FOUND");

        const updated = await suppliersRepository.update(supplierId, patch);

        logger.info("suppliersService.update success", { supplierId: updated.id });

        return updated;
    },

    async delete(params: {
        supplierId: string;
        requesterUserId: string;
        requesterRole?: string;
    }): Promise<void> {
        const { supplierId, requesterUserId, requesterRole } = params;

        logger.info("suppliersService.delete called", { supplierId, requesterUserId, requesterRole });

        const existing = await suppliersRepository.findById(supplierId);
        if (!existing) throw new AppError(404, "Supplier not found", "NOT_FOUND");

        await suppliersRepository.delete(supplierId);

        logger.info("suppliersService.delete success", { supplierId });
    },
};

// ─── Stock Movements ──────────────────────────────────────────────────────────

export const stockMovementsService = {
    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateStockMovementBody;
    }): Promise<StockMovement> {
        const { requesterUserId, requesterRole, body } = params;

        logger.info("stockMovementsService.create called", {
            requesterUserId,
            requesterRole,
            productId: body.product_id,
            movementType: body.movement_type,
        });

        const created = await stockMovementsRepository.create(body, requesterUserId);

        logger.info("stockMovementsService.create success", {
            movementId: created.id,
            movementType: created.movement_type,
            quantity: created.quantity,
        });

        return created;
    },

    async getById(id: string): Promise<StockMovement> {
        const movement = await stockMovementsRepository.findById(id);
        if (!movement) throw new AppError(404, "Stock movement not found", "NOT_FOUND");
        return movement;
    },

    async list(
        filters: ListStockMovementsFilters
    ): Promise<{ data: StockMovement[]; total: number; page: number; limit: number }> {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;

        const { data, total } = await stockMovementsRepository.list({ ...filters, page, limit });

        return { data, total, page, limit };
    },
};

// ─── Stock Take ───────────────────────────────────────────────────────────────

export const stockTakeService = {
    async process(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: StockTakeBody;
    }): Promise<StockTakeResult> {
        const { requesterUserId, requesterRole, body } = params;

        logger.info("stockTakeService.process called", {
            requesterUserId,
            requesterRole,
            branchId: body.branch_id,
            itemCount: body.items.length,
        });

        const movements = await stockTakeRepository.process({
            branch_id: body.branch_id,
            notes: body.notes,
            items: body.items,
            created_by: requesterUserId,
        });

        logger.info("stockTakeService.process success", {
            processed: body.items.length,
            movementsCreated: movements.length,
        });

        return { processed: body.items.length, movements };
    },
};
