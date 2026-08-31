import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { stockLedgerRepository } from "./stock-ledger.repository";
import {
    CreateStockLedgerEntryBody,
    UpdateStockLedgerEntryBody,
    ListStockLedgerFilters,
} from "./stock-ledger.types";

async function getOwned(id: string, salonId: string) {
    const entry = await stockLedgerRepository.findById(id, salonId);
    if (!entry) throw new AppError(404, "Stock ledger entry not found", "NOT_FOUND");
    return entry;
}

export const stockLedgerService = {
    async create(params: { requesterUserId: string; requesterRole?: string; salonId: string; body: CreateStockLedgerEntryBody }) {
        const { requesterUserId, requesterRole, salonId, body } = params;

        if (!body.branch_id) throw new AppError(400, "branch_id is required", "VALIDATION_ERROR");
        if (!body.product_id) throw new AppError(400, "product_id is required", "VALIDATION_ERROR");
        if (!body.quantity || body.quantity <= 0) throw new AppError(400, "quantity must be greater than 0", "VALIDATION_ERROR");

        logger.info("stockLedgerService.create called", {
            requesterUserId, requesterRole, productId: body.product_id, transactionType: body.transaction_type,
        });

        let created;
        try {
            created = await stockLedgerRepository.create(body, requesterUserId, salonId);
        } catch (err) {
            if (err instanceof Error && err.message === "Product not found in this salon") {
                throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
            }
            throw err;
        }

        logger.info("stockLedgerService.create success", {
            entryId: created.id, transactionType: created.transaction_type, balanceAfter: created.balance_after,
        });
        return created;
    },

    async list(filters: ListStockLedgerFilters, salonId: string) {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 25;
        const [{ data, total }, summary] = await Promise.all([
            stockLedgerRepository.list({ ...filters, page, limit }, salonId),
            stockLedgerRepository.getSummary(filters, salonId),
        ]);
        return { data, total, page, limit, summary };
    },

    async getById(id: string, salonId: string) {
        return getOwned(id, salonId);
    },

    async getTimelineForProduct(productId: string, salonId: string) {
        return stockLedgerRepository.getTimelineForProduct(productId, salonId);
    },

    async update(id: string, data: UpdateStockLedgerEntryBody, salonId: string) {
        await getOwned(id, salonId);
        const updated = await stockLedgerRepository.update(id, data, salonId);
        if (!updated) throw new AppError(404, "Stock ledger entry not found", "NOT_FOUND");
        return updated;
    },

    async delete(id: string, salonId: string): Promise<void> {
        await getOwned(id, salonId);
        const deleted = await stockLedgerRepository.delete(id, salonId);
        if (!deleted) throw new AppError(404, "Stock ledger entry not found", "NOT_FOUND");
    },
};
