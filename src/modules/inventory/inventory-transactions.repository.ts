import { PoolClient } from "pg";
import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import {
  InventoryShortfall,
  InventoryTransactionItem,
  InventoryTransactionParams,
} from "./inventory-transactions.types";

const REASON_LABEL: Record<InventoryTransactionParams["reason"], string> = {
  consumable_usage: "Consumable usage",
  adjustment: "Adjustment",
};

const buildNote = (params: InventoryTransactionParams): string => {
  const label = REASON_LABEL[params.reason];
  return params.referenceId
    ? `${label} (${params.referenceType}, ref ${params.referenceId})`
    : `${label} (${params.referenceType})`;
};

const aggregateByProduct = (items: InventoryTransactionItem[]): Map<string, number> => {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.product_id, (totals.get(item.product_id) ?? 0) + Number(item.qty));
  }
  return totals;
};

async function applyMovement(
  params: InventoryTransactionParams,
  direction: "deduct" | "return",
  externalClient?: PoolClient
): Promise<void> {
  const { reason, items, salonId, branchId, referenceId, userId, allowNegative = false } = params;
  if (!items.length) return;

  const client = externalClient ?? (await pool.connect());
  const managesOwnTransaction = !externalClient;

  try {
    if (managesOwnTransaction) await client.query("BEGIN");

    // Lock + read each distinct product once, aggregating the quantity
    // needed across all items for that product — a single appointment can
    // have two service rows both consuming the same product.
    const totals = aggregateByProduct(items);
    const productInfo = new Map<string, { name: string; amount: number }>();
    for (const productId of totals.keys()) {
      const { rows } = await client.query(
        `SELECT name, amount FROM products WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
        [productId, salonId]
      );
      if (!rows.length) continue; // unknown/foreign product — skip silently, same convention as the manual consumable-usage endpoint
      productInfo.set(productId, { name: rows[0].name, amount: Number(rows[0].amount) || 0 });
    }

    if (direction === "deduct" && !allowNegative) {
      const shortfalls: InventoryShortfall[] = [];
      for (const [productId, required] of totals) {
        const info = productInfo.get(productId);
        if (!info) continue;
        if (required > info.amount) {
          shortfalls.push({
            product_id: productId,
            product_name: info.name,
            available: info.amount,
            required,
            short_by: Number((required - info.amount).toFixed(3)),
          });
        }
      }
      if (shortfalls.length) {
        const summary = shortfalls
          .map((s) => `${s.product_name} (need ${s.required}, have ${s.available})`)
          .join("; ");
        throw new AppError(400, `Insufficient stock: ${summary}`, "INSUFFICIENT_STOCK", { shortfalls });
      }
    }

    // Apply the aggregated stock change: one products.amount update and one
    // stock_movements audit row per distinct product.
    for (const [productId, qty] of totals) {
      if (!productInfo.has(productId)) continue;
      const delta = direction === "deduct" ? -qty : qty;
      await client.query(
        `UPDATE products SET amount = GREATEST(amount + $1, 0), updated_at = NOW() WHERE id = $2`,
        [delta, productId]
      );
      await client.query(
        `INSERT INTO stock_movements (branch_id, product_id, movement_type, quantity, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [branchId, productId, direction === "deduct" ? "out" : "in", qty, buildNote(params), userId]
      );
    }

    // ...but one consumable_usage ledger row PER ORIGINAL ITEM (not
    // aggregated), so two service rows sharing a product stay separately
    // auditable/reversible by service_row_id.
    if (reason === "consumable_usage") {
      for (const item of items) {
        if (!productInfo.has(item.product_id)) continue;
        await client.query(
          `INSERT INTO consumable_usage
             (salon_id, branch_id, product_id, booking_id, qty, unit, used_by, service_row_id, service_id, direction, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            salonId, branchId, item.product_id, referenceId ?? null, item.qty,
            item.unit ?? null, userId, item.service_row_id ?? null, item.service_id ?? null,
            direction, params.referenceType,
          ]
        );
      }
    }

    if (managesOwnTransaction) await client.query("COMMIT");
  } catch (err) {
    if (managesOwnTransaction) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (managesOwnTransaction) client.release();
  }
}

export const inventoryTransactionsRepository = {
  // Read-only pre-check so callers can fail fast (e.g. before writing a
  // payment row) with a friendly, named-shortfall error. NOT a substitute
  // for the row-locked re-check inside deduct() itself, which closes the
  // race between this check and the actual write.
  async validateAvailability(items: InventoryTransactionItem[], salonId: string): Promise<InventoryShortfall[]> {
    const totals = aggregateByProduct(items);
    if (!totals.size) return [];

    const { rows } = await pool.query(
      `SELECT id, name, amount FROM products WHERE id = ANY($1::uuid[]) AND salon_id = $2`,
      [[...totals.keys()], salonId]
    );

    const shortfalls: InventoryShortfall[] = [];
    for (const [productId, required] of totals) {
      const product = rows.find((r: any) => r.id === productId);
      const available = Number(product?.amount ?? 0);
      if (required > available) {
        shortfalls.push({
          product_id: productId,
          product_name: product?.name ?? "Unknown product",
          available,
          required,
          short_by: Number((required - available).toFixed(3)),
        });
      }
    }
    return shortfalls;
  },

  async deduct(params: InventoryTransactionParams, client?: PoolClient): Promise<void> {
    await applyMovement(params, "deduct", client);
  },

  async restore(params: InventoryTransactionParams, client?: PoolClient): Promise<void> {
    await applyMovement(params, "return", client);
  },
};
