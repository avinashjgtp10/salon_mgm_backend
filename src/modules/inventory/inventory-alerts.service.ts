// ============================================================
// SalonOx — Inventory Alert Notifications
// ============================================================
// Central place that decides whether a product's current stock/expiry state
// should raise, refresh, or resolve a low_stock / out_of_stock /
// expiring_soon / expired notification. Every stock-mutating call site
// (sales, purchases, adjustments, audits, consumable usage, stocktakes)
// fires checkAndNotify() AFTER its own transaction commits — this never
// runs inside another writer's transaction, so an alert-check failure can
// never roll back a real stock change. Also driven by the nightly
// expiry-alerts sweep for the pure time-based statuses (expiring_soon,
// expired), since those can newly trigger with no stock mutation at all.
//
// Status formula mirrors product-inventory.repository.ts's STOCK_IN_PACKS /
// status CASE exactly — same "low stock" and "expiring soon" definitions
// the Product Inventory page already shows, so a notification always agrees
// with what the page displays for that product.

import pool from "../../config/database";
import logger from "../../config/logger";
import { notificationsService } from "../notifications/notifications.service";
import { notificationsRepository } from "../notifications/notifications.repository";

export type InventoryAlertStatus = "low_stock" | "out_of_stock" | "expiring_soon" | "expired";

const EXPIRY_WARNING_DAYS = 30;

interface AlertCandidateRow {
  id: string;
  salon_id: string;
  name: string;
  amount: number;
  qty_alert: number | null;
  bottle_size: number | null;
  expiry_date: string | null;
  branch_id: string | null;
}

// One row per candidate product, with the same low_stock/expiry math as
// the Product Inventory list — plus a best-effort branch_id (most recent
// stock_movements row for the product, falling back to the salon's main
// branch) purely so the notification can carry a branch for the frontend's
// click-through; it plays no part in the status calculation itself, since
// products.amount is a single salon-wide figure, not per-branch.
async function fetchCandidates(productIds: string[], salonId: string): Promise<AlertCandidateRow[]> {
  if (!productIds.length) return [];
  const { rows } = await pool.query<AlertCandidateRow>(
    `SELECT p.id, p.salon_id, p.name,
            COALESCE(p.amount, 0)::float8 AS amount,
            p.qty_alert, p.bottle_size, p.expiry_date,
            (
              SELECT sm.branch_id FROM stock_movements sm
               WHERE sm.product_id = p.id
               ORDER BY sm.created_at DESC LIMIT 1
            ) AS branch_id
       FROM products p
      WHERE p.id = ANY($1::uuid[]) AND p.salon_id = $2 AND p.is_active = true`,
    [productIds, salonId]
  );
  return rows;
}

function stockInPacks(row: AlertCandidateRow): number {
  const bottleSize = Number(row.bottle_size) || 0;
  return bottleSize > 0 ? row.amount / bottleSize : row.amount;
}

function deriveStatus(row: AlertCandidateRow): InventoryAlertStatus | null {
  if (row.amount <= 0) return "out_of_stock";

  if (row.qty_alert != null && row.qty_alert > 0 && Math.ceil(stockInPacks(row)) <= row.qty_alert) {
    return "low_stock";
  }

  if (row.expiry_date) {
    const expiry = new Date(row.expiry_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.floor((expiry.getTime() - today.getTime()) / 86_400_000);
    if (daysLeft < 0) return "expired";
    if (daysLeft <= EXPIRY_WARNING_DAYS) return "expiring_soon";
  }

  return null;
}

function buildNotificationCopy(row: AlertCandidateRow, status: InventoryAlertStatus): { title: string; body: string } {
  switch (status) {
    case "out_of_stock":
      return {
        title: "Product out of stock",
        body: `${row.name} is out of stock (0 remaining).`,
      };
    case "low_stock":
      return {
        title: "Low stock alert",
        body: `${row.name} is low on stock — ${Math.ceil(stockInPacks(row))} left (threshold: ${row.qty_alert}).`,
      };
    case "expired": {
      return { title: "Product expired", body: `${row.name} has expired (expiry date: ${row.expiry_date}).` };
    }
    case "expiring_soon": {
      const expiry = new Date(row.expiry_date as string);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysLeft = Math.max(0, Math.floor((expiry.getTime() - today.getTime()) / 86_400_000));
      return {
        title: "Product expiring soon",
        body: `${row.name} expires on ${row.expiry_date} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left).`,
      };
    }
  }
}

async function checkOne(row: AlertCandidateRow): Promise<void> {
  const status = deriveStatus(row);

  // Close out any active alert whose status no longer applies (stock
  // replenished above threshold, expired batch written off, etc). If a
  // status still applies it's left alone here — the create-or-refresh step
  // below decides whether it needs a body/title update.
  await notificationsRepository.resolveActiveAlertsExcept(row.id, status ? [status] : []);

  if (!status) return;

  const existing = await notificationsRepository.findActiveAlert(row.id, status);
  const { title, body } = buildNotificationCopy(row, status);

  if (existing) {
    // Same ongoing alert — refresh copy (e.g. stock count changed but is
    // still under threshold) without spamming a second notification/toast.
    if (existing.title !== title || existing.body !== body) {
      await notificationsRepository.touchAlert(existing.id, { title, body });
    }
    return;
  }

  await notificationsService.create({
    salon_id: row.salon_id,
    type: "warning",
    title,
    body,
    event_key: "inventoryAlert",
    product_id: row.id,
    branch_id: row.branch_id ?? undefined,
    alert_status: status,
  });
}

export const inventoryAlertsService = {
  // Fire-and-forget from every stock-mutation call site, after commit.
  // Never throws — a failed alert check must never surface as a failure of
  // the sale/purchase/adjustment that triggered it.
  async checkAndNotify(productIds: string[], salonId: string): Promise<void> {
    const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
    if (!uniqueIds.length) return;
    try {
      const candidates = await fetchCandidates(uniqueIds, salonId);
      for (const row of candidates) {
        await checkOne(row).catch((err) =>
          logger.warn("[INVENTORY-ALERTS] failed to check product", { productId: row.id, message: err?.message })
        );
      }
    } catch (err: any) {
      logger.warn("[INVENTORY-ALERTS] checkAndNotify failed", { salonId, message: err?.message });
    }
  },

  // Driven by the nightly sweep — scans every active product with an
  // expiry_date across all salons, since expiring_soon/expired can newly
  // trigger purely from the passage of time with no stock mutation at all.
  async sweepExpiring(): Promise<void> {
    const { rows } = await pool.query<AlertCandidateRow>(
      `SELECT p.id, p.salon_id, p.name,
              COALESCE(p.amount, 0)::float8 AS amount,
              p.qty_alert, p.bottle_size, p.expiry_date,
              (
                SELECT sm.branch_id FROM stock_movements sm
                 WHERE sm.product_id = p.id
                 ORDER BY sm.created_at DESC LIMIT 1
              ) AS branch_id
         FROM products p
        WHERE p.is_active = true
          AND p.expiry_date IS NOT NULL
          AND p.expiry_date <= CURRENT_DATE + INTERVAL '${EXPIRY_WARNING_DAYS} days'`
    );
    for (const row of rows) {
      await checkOne(row).catch((err) =>
        logger.warn("[INVENTORY-ALERTS] sweep failed for product", { productId: row.id, message: err?.message })
      );
    }
  },
};
