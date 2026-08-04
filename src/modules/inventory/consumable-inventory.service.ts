import { AppError } from "../../middleware/error.middleware";
import { productsRepository } from "../products/products.repository";
import { consumableInventoryRepository } from "./consumable-inventory.repository";
import { inventoryTransactionsRepository } from "./inventory-transactions.repository";
import { appointmentConsumablesService } from "./inventory.service";
import {
  AdjustStockBody,
  ConsumableDetail,
  ConsumableKpis,
  ConsumableListFilters,
  ConsumableListResponse,
  UsageHistoryFilters,
  UsageHistoryResponse,
} from "./consumable-inventory.types";

export const consumableInventoryService = {
  async list(filters: ConsumableListFilters, salonId: string): Promise<ConsumableListResponse> {
    return consumableInventoryRepository.list(filters, salonId);
  },

  async getKpis(salonId: string): Promise<ConsumableKpis> {
    return consumableInventoryRepository.getKpis(salonId);
  },

  async getById(productId: string, salonId: string): Promise<ConsumableDetail> {
    const detail = await consumableInventoryRepository.getDetail(productId, salonId);
    if (!detail) throw new AppError(404, "Consumable product not found", "NOT_FOUND");
    return detail;
  },

  async listUsageHistory(filters: UsageHistoryFilters, salonId: string): Promise<UsageHistoryResponse> {
    return consumableInventoryRepository.listUsageHistory(filters, salonId);
  },

  // Manual stock adjustment (Purchase/Damage/Expired/Manual Correction) —
  // deliberately routed through the SAME generic InventoryTransactionService
  // the appointment-completion deduction engine uses (reason='adjustment'),
  // rather than a bespoke UPDATE products SET amount — one inventory-movement
  // code path, one audit trail (consumable_usage + stock_movements), for
  // every reason stock ever changes.
  async adjustStock(params: { productId: string; salonId: string; userId: string; body: AdjustStockBody }): Promise<void> {
    const { productId, salonId, userId, body } = params;
    if (!Number.isFinite(body.qty) || body.qty <= 0) {
      throw new AppError(400, "qty must be a positive number", "VALIDATION_ERROR");
    }
    const product = await productsRepository.findById(productId, salonId);
    if (!product) throw new AppError(404, "Consumable product not found", "NOT_FOUND");

    const branchId = body.branch_id || (await appointmentConsumablesService.resolveBranchId(salonId, null));
    if (!branchId) throw new AppError(400, "No branch found for this salon", "NO_BRANCH");

    const items = [{ product_id: productId, qty: body.qty, unit: product.measure_unit }];
    const params2 = {
      reason: "adjustment" as const,
      items,
      salonId,
      branchId,
      referenceType: "manual" as const,
      userId,
      // Damage/expired/manual-correction decreases can legitimately exceed
      // what's on hand if the count was already wrong — but a Purchase
      // (increase) never needs the hard-block, and a "decrease" should still
      // be blocked from going negative for the same reason appointment
      // deduction is: never let recorded stock go below zero.
      allowNegative: false,
    };

    if (body.direction === "increase") {
      await inventoryTransactionsRepository.restore(params2);
    } else {
      await inventoryTransactionsRepository.deduct(params2);
    }
  },
};
