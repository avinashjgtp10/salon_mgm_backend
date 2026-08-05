import { AppError } from "../../middleware/error.middleware";
import { productsRepository } from "../products/products.repository";
import { consumableInventoryRepository } from "./consumable-inventory.repository";
import { inventoryTransactionsRepository } from "./inventory-transactions.repository";
import { appointmentConsumablesService } from "./inventory.service";
import {
  AdjustStockBody,
  AssignedServiceRow,
  ConsumableDetail,
  ConsumableKpis,
  ConsumableListFilters,
  ConsumableListResponse,
  UnitConversion,
  UnitConversionInput,
  UsageHistoryFilters,
  UsageHistoryResponse,
} from "./consumable-inventory.types";

const VALID_UNIT_NAME_RE = /^[a-zA-Z0-9 _/-]{1,30}$/;

function validateUnitConversions(conversions: unknown): UnitConversionInput[] {
  if (!Array.isArray(conversions)) {
    throw new AppError(400, "unit_conversions must be an array", "VALIDATION_ERROR");
  }
  const seen = new Set<string>();
  return conversions.map((c: any) => {
    const unitName = String(c?.unit_name ?? "").trim();
    const conversion = Number(c?.conversion_to_base);
    if (!VALID_UNIT_NAME_RE.test(unitName)) {
      throw new AppError(400, `Invalid unit name: "${unitName}"`, "VALIDATION_ERROR");
    }
    if (!Number.isFinite(conversion) || conversion <= 0) {
      throw new AppError(400, `${unitName}: conversion_to_base must be a positive number`, "VALIDATION_ERROR");
    }
    const key = unitName.toLowerCase();
    if (seen.has(key)) {
      throw new AppError(400, `Duplicate unit name: "${unitName}"`, "VALIDATION_ERROR");
    }
    seen.add(key);
    return { unit_name: unitName, conversion_to_base: conversion };
  });
}

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

  // Thin, single-purpose read for the table's "Assigned Services" click-popup
  // — the full getById() above does several other unrelated queries (usage
  // stats, recent consumption, unit conversions) the popup doesn't need.
  async getAssignedServices(productId: string, salonId: string): Promise<AssignedServiceRow[]> {
    const product = await productsRepository.findById(productId, salonId);
    if (!product) throw new AppError(404, "Consumable product not found", "NOT_FOUND");
    return consumableInventoryRepository.getAssignedServices(productId);
  },

  async getUnitConversions(productId: string, salonId: string): Promise<UnitConversion[]> {
    const product = await productsRepository.findById(productId, salonId);
    if (!product) throw new AppError(404, "Consumable product not found", "NOT_FOUND");
    return consumableInventoryRepository.getUnitConversions(productId);
  },

  async replaceUnitConversions(productId: string, salonId: string, conversions: unknown): Promise<UnitConversion[]> {
    const product = await productsRepository.findById(productId, salonId);
    if (!product) throw new AppError(404, "Consumable product not found", "NOT_FOUND");
    const validated = validateUnitConversions(conversions);
    return consumableInventoryRepository.replaceUnitConversions(productId, validated);
  },
};
