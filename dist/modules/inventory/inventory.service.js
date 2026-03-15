"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockTakeService = exports.stockMovementsService = exports.suppliersService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const inventory_repository_1 = require("./inventory.repository");
// ─── Suppliers ────────────────────────────────────────────────────────────────
exports.suppliersService = {
    async create(params) {
        const { requesterUserId, requesterRole, body } = params;
        logger_1.default.info("suppliersService.create called", {
            requesterUserId,
            requesterRole,
        });
        const created = await inventory_repository_1.suppliersRepository.create(body);
        logger_1.default.info("suppliersService.create success", {
            supplierId: created.id,
        });
        return created;
    },
    async getById(id) {
        const supplier = await inventory_repository_1.suppliersRepository.findById(id);
        if (!supplier)
            throw new error_middleware_1.AppError(404, "Supplier not found", "NOT_FOUND");
        return supplier;
    },
    async listAll() {
        return inventory_repository_1.suppliersRepository.listAll();
    },
    async update(params) {
        const { supplierId, requesterUserId, requesterRole, patch } = params;
        logger_1.default.info("suppliersService.update called", { supplierId, requesterUserId, requesterRole });
        const existing = await inventory_repository_1.suppliersRepository.findById(supplierId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Supplier not found", "NOT_FOUND");
        const updated = await inventory_repository_1.suppliersRepository.update(supplierId, patch);
        logger_1.default.info("suppliersService.update success", { supplierId: updated.id });
        return updated;
    },
    async delete(params) {
        const { supplierId, requesterUserId, requesterRole } = params;
        logger_1.default.info("suppliersService.delete called", { supplierId, requesterUserId, requesterRole });
        const existing = await inventory_repository_1.suppliersRepository.findById(supplierId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Supplier not found", "NOT_FOUND");
        await inventory_repository_1.suppliersRepository.delete(supplierId);
        logger_1.default.info("suppliersService.delete success", { supplierId });
    },
};
// ─── Stock Movements ──────────────────────────────────────────────────────────
exports.stockMovementsService = {
    async create(params) {
        const { requesterUserId, requesterRole, body } = params;
        logger_1.default.info("stockMovementsService.create called", {
            requesterUserId,
            requesterRole,
            productId: body.product_id,
            movementType: body.movement_type,
        });
        const created = await inventory_repository_1.stockMovementsRepository.create(body, requesterUserId);
        logger_1.default.info("stockMovementsService.create success", {
            movementId: created.id,
            movementType: created.movement_type,
            quantity: created.quantity,
        });
        return created;
    },
    async getById(id) {
        const movement = await inventory_repository_1.stockMovementsRepository.findById(id);
        if (!movement)
            throw new error_middleware_1.AppError(404, "Stock movement not found", "NOT_FOUND");
        return movement;
    },
    async list(filters) {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const { data, total } = await inventory_repository_1.stockMovementsRepository.list({ ...filters, page, limit });
        return { data, total, page, limit };
    },
};
// ─── Stock Take ───────────────────────────────────────────────────────────────
exports.stockTakeService = {
    async process(params) {
        const { requesterUserId, requesterRole, body } = params;
        logger_1.default.info("stockTakeService.process called", {
            requesterUserId,
            requesterRole,
            branchId: body.branch_id,
            itemCount: body.items.length,
        });
        const movements = await inventory_repository_1.stockTakeRepository.process({
            branch_id: body.branch_id,
            notes: body.notes,
            items: body.items,
            created_by: requesterUserId,
        });
        logger_1.default.info("stockTakeService.process success", {
            processed: body.items.length,
            movementsCreated: movements.length,
        });
        return { processed: body.items.length, movements };
    },
};
//# sourceMappingURL=inventory.service.js.map