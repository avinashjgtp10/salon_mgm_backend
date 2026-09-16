import pool from "../../config/database";
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
import { FAMILY_MESSAGE, findCompatibleUnit } from "./unit-families";

const VALID_UNIT_NAME_RE = /^[a-zA-Z0-9 _/-]{1,30}$/;

// `baseUnit` is the product's own measure_unit (products.measure_unit) —
// every conversion unit must belong to the SAME measurement family (Volume:
// ml/L, Weight: gm/kg, Count: pcs) or it's rejected outright. System-defined
// units (L, kg) have a fixed, non-negotiable ratio — whatever the caller
// sent for those is overwritten with the real one rather than trusted,
// so a client bypassing the form's disabled input can't set "1 L = 500 ml".
function validateUnitConversions(conversions: unknown, baseUnit: string): UnitConversionInput[] {
  if (!Array.isArray(conversions)) {
    throw new AppError(400, "unit_conversions must be an array", "VALIDATION_ERROR");
  }
  const seen = new Set<string>();
  return conversions.map((c: any) => {
    const unitName = String(c?.unit_name ?? "").trim();
    let conversion = Number(c?.conversion_to_base);
    if (!VALID_UNIT_NAME_RE.test(unitName)) {
      throw new AppError(400, `Invalid unit name: "${unitName}"`, "VALIDATION_ERROR");
    }
    const compatible = findCompatibleUnit(baseUnit, unitName);
    if (!compatible) {
      throw new AppError(400, FAMILY_MESSAGE, "INVALID_UNIT_CONVERSION", { unit_name: unitName, base_unit: baseUnit });
    }
    if (compatible.fixedRatio !== undefined) {
      conversion = compatible.fixedRatio;
    } else if (!Number.isFinite(conversion) || conversion <= 0) {
      throw new AppError(400, `${unitName}: conversion_to_base must be a positive number`, "VALIDATION_ERROR");
    }
    const key = unitName.toLowerCase();
    if (seen.has(key)) {
      throw new AppError(400, `Duplicate unit name: "${unitName}"`, "VALIDATION_ERROR");
    }
    seen.add(key);
    return { unit_name: compatible.name, conversion_to_base: conversion };
  });
}

export const consumableInventoryService = {
  async list(filters: ConsumableListFilters, salonId: string): Promise<ConsumableListResponse> {
    return consumableInventoryRepository.list(filters, salonId);
  },

  async getKpis(salonId: string): Promise<ConsumableKpis> {
    return consumableInventoryRepository.getKpis(salonId);
  },

  // Combined list + KPIs in one round trip — the Consumable Inventory page's
  // initial load (and every filter/search/page change) previously fired
  // these as two separate HTTP requests; they don't depend on each other, so
  // running both queries concurrently server-side and returning them
  // together costs nothing extra in latency but halves the request count.
  async getDashboard(filters: ConsumableListFilters, salonId: string): Promise<{ kpis: ConsumableKpis; list: ConsumableListResponse }> {
    const [kpis, list] = await Promise.all([
      consumableInventoryRepository.getKpis(salonId),
      consumableInventoryRepository.list(filters, salonId),
    ]);
    return { kpis, list };
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

  // ── Revert a consumable deduction ──────────────────────────────────────────
  // Undoes a deduction that was recorded but never actually consumed (the
  // product wasn't used for that service after all).
  //
  // Everything happens in ONE transaction, deliberately: stock lives on
  // products.amount while the audit trail lives in consumable_usage, so a
  // partial failure between the two would leave the figure and the log
  // disagreeing with no way to tell which is right.
  //
  // The original consumption row is never deleted or re-pointed — it is only
  // stamped reverted_at/reverted_by, and a NEW 'return' row carrying
  // reverts_usage_id records the reversal beside it.
  async revertUsage(params: {
    usageId: string;
    salonId: string;
    userId: string;
    reason?: string;
  }): Promise<{ product_name: string; qty: number; restored_to: number }> {
    const { usageId, salonId, userId, reason } = params;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // FOR UPDATE OF cu locks only the usage row — products is locked a
      // moment later by applyMovement's own FOR UPDATE, and taking them in
      // that order everywhere avoids a deadlock against a concurrent
      // deduction doing the same.
      const { rows } = await client.query(
        `SELECT cu.id, cu.product_id, cu.branch_id, cu.qty, cu.unit, cu.booking_id,
                cu.service_id, cu.service_row_id, cu.direction, cu.reverted_at,
                p.name AS product_name, COALESCE(p.amount, 0) AS current_stock
           FROM consumable_usage cu
           JOIN products p ON p.id = cu.product_id
          WHERE cu.id = $1 AND cu.salon_id = $2
          FOR UPDATE OF cu`,
        [usageId, salonId]
      );

      const row = rows[0];
      if (!row) throw new AppError(404, "Usage record not found", "NOT_FOUND");
      if (row.direction !== "deduct") {
        throw new AppError(400, "Only a deduction can be reverted.", "NOT_A_DEDUCTION");
      }
      if (row.reverted_at) {
        throw new AppError(409, "This deduction has already been reverted.", "ALREADY_REVERTED");
      }

      const qty = Number(row.qty) || 0;
      if (qty <= 0) {
        throw new AppError(400, "This record has no quantity to restore.", "VALIDATION_ERROR");
      }

      const branchId =
        row.branch_id || (await appointmentConsumablesService.resolveBranchId(salonId, null));
      if (!branchId) throw new AppError(400, "No branch found for this salon", "NO_BRANCH");

      // reason 'adjustment', not 'consumable_usage': that reason makes
      // applyMovement write its own consumable_usage row, which would have no
      // link back to the deduction being reverted. This moves the stock and
      // writes the stock_movements row, and the linked ledger row is inserted
      // below where reverts_usage_id can be set on it.
      await inventoryTransactionsRepository.restore(
        {
          reason: "adjustment",
          items: [{ product_id: row.product_id, qty, unit: row.unit ?? undefined }],
          salonId,
          branchId,
          referenceType: "revert",
          referenceId: usageId,
          userId,
        },
        client
      );

      // The reversal row. Mirrors the original's service/booking context so it
      // lines up beside it in the history list, but with direction 'return'.
      // A unique index on reverts_usage_id means a second concurrent revert of
      // the same deduction fails HERE, inside this transaction, after having
      // passed the reverted_at check above — so its stock restore is rolled
      // back rather than double-counted.
      await client.query(
        `INSERT INTO consumable_usage
           (salon_id, branch_id, product_id, booking_id, qty, unit, used_by,
            service_row_id, service_id, direction, source, notes, reverts_usage_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'return','revert',$10,$11)`,
        [
          salonId, branchId, row.product_id, row.booking_id, qty, row.unit ?? null,
          userId, row.service_row_id ?? null, row.service_id ?? null,
          reason?.trim() || null, usageId,
        ]
      );

      const upd = await client.query(
        `UPDATE consumable_usage
            SET reverted_at = NOW(), reverted_by = $1
          WHERE id = $2 AND reverted_at IS NULL`,
        [userId, usageId]
      );
      if ((upd.rowCount ?? 0) === 0) {
        throw new AppError(409, "This deduction has already been reverted.", "ALREADY_REVERTED");
      }

      await client.query("COMMIT");

      return {
        product_name: row.product_name,
        qty,
        restored_to: Number(row.current_stock) + qty,
      };
    } catch (err: any) {
      // Swallow a rollback failure: if the connection is already broken the
      // transaction is dead anyway, and throwing here would mask the real cause.
      await client.query("ROLLBACK").catch(() => { /* see above */ });
      // The unique-index violation is the concurrent-double-click case — report
      // it as the same conflict the pre-check would have given, not a 500.
      if (err?.code === "23505") {
        throw new AppError(409, "This deduction has already been reverted.", "ALREADY_REVERTED");
      }
      throw err;
    } finally {
      client.release();
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
    const validated = validateUnitConversions(conversions, product.measure_unit);
    return consumableInventoryRepository.replaceUnitConversions(productId, validated);
  },
};
