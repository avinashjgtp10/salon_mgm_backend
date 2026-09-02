import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { stockLedgerRepository } from "./stock-ledger.repository";
import { appointmentConsumablesService } from "./inventory.service";
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

    // Called fire-and-forget from every checkout path right where
    // commissionCalculationService.calculateForSale already is (see
    // sales.service.ts#checkout and both branches of
    // appointments.service.ts#checkout) — a completed sale's retail product
    // lines (item_type='product') should deduct stock and appear in the
    // Stock Ledger the same way a Purchase does, which nothing did before
    // this. Never throws: a stock-ledger failure must not be able to surface
    // as a checkout failure after payment has already been taken, so this
    // logs and swallows internally — callers can still .catch(() => {}) as
    // a second guard, matching the existing double-guard convention.
    async deductForSale(params: {
        salonId: string;
        branchId: string | null;
        saleId: string;
        invoiceNumber: string | null;
        createdBy: string | null;
        items: { item_type: string; item_id: string | null; quantity: number }[];
    }): Promise<void> {
        try {
            const productItems = params.items
                .filter((i) => i.item_type === "product" && i.item_id)
                .map((i) => ({ product_id: i.item_id as string, quantity: Number(i.quantity) || 0 }))
                .filter((i) => i.quantity > 0);
            if (!productItems.length) return;

            const branchId = params.branchId ?? await appointmentConsumablesService.resolveBranchId(params.salonId, null);
            if (!branchId) {
                logger.warn("stockLedgerService.deductForSale: no branch resolvable, skipping", { saleId: params.saleId });
                return;
            }

            await stockLedgerRepository.deductForSale(
                { salonId: params.salonId, branchId, saleId: params.saleId, invoiceNumber: params.invoiceNumber, items: productItems },
                params.createdBy,
            );
        } catch (err: any) {
            logger.error("stockLedgerService.deductForSale failed", { saleId: params.saleId, error: err?.message ?? err });
        }
    },
};
