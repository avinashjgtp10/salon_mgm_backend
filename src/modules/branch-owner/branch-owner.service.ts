import jwt, { Secret } from "jsonwebtoken";
import pool from "../../config/database";
import { branchOwnerRepository } from "./branch-owner.repository";
import { superAdminRepository } from "../super-admin/super-admin.repository";
import { AppError } from "../../middleware/error.middleware";
import { salonDashboardRepository } from "../salon-dashboard/salon-dashboard.repository";
import { staffCommissionsService } from "../staff/staff.service";

const ACCESS_SECRET: Secret = process.env.JWT_ACCESS_SECRET || "";

async function assertSalonsAssigned(branchOwnerId: string, salonIds: string[]) {
    for (const salonId of salonIds) {
        const ok = await branchOwnerRepository.isSalonAssignedToBranchOwner(branchOwnerId, salonId);
        if (!ok) throw new AppError(403, "Salon not assigned to you", "FORBIDDEN");
    }
}

export const branchOwnerService = {

  async getMySalons(branchOwnerId: string) {
    return branchOwnerRepository.getMySalons(branchOwnerId);
  },

  // Single combined payload for the Branch Owner dashboard — replaces what
  // used to be 3 separate calls (salons, stats, payments), 2 of which
  // (/stats, /payments) hit routes that never existed on the backend and
  // silently 404'd, leaving those cards permanently empty on the frontend.
  async getDashboard(branchOwnerId: string) {
    const [salons, stats, payments] = await Promise.all([
      branchOwnerRepository.getMySalons(branchOwnerId),
      branchOwnerRepository.getDashboardStats(branchOwnerId),
      branchOwnerRepository.getRecentPayments(branchOwnerId, 10),
    ]);
    return { salons, stats, payments };
  },

  async getPayments(branchOwnerId: string, status?: string) {
    return branchOwnerRepository.getRecentPayments(branchOwnerId, 200, status);
  },

  async listSalonProducts(branchOwnerId: string, salonId: string, search?: string) {
    await assertSalonsAssigned(branchOwnerId, [salonId]);
    return branchOwnerRepository.listProductsForSalon(salonId, search);
  },

  // Best-effort match for the destination-side picker: barcode first (most
  // reliable), then exact case-insensitive name — surfaced to the frontend
  // as a *suggestion* the sender confirms or overrides, never auto-applied
  // silently.
  async suggestMatch(branchOwnerId: string, sourceSalonId: string, sourceProductId: string, destSalonId: string) {
    await assertSalonsAssigned(branchOwnerId, [sourceSalonId, destSalonId]);
    const source = await branchOwnerRepository.findProduct(sourceProductId, sourceSalonId);
    if (!source) throw new AppError(404, "Source product not found", "NOT_FOUND");

    const destCandidates = await branchOwnerRepository.listProductsForSalon(destSalonId);
    const byBarcode = source.barcode
        ? destCandidates.find((p) => p.barcode && p.barcode === source.barcode)
        : undefined;
    const byName = destCandidates.find((p) => p.name.trim().toLowerCase() === source.name.trim().toLowerCase());

    return { source, suggested: byBarcode ?? byName ?? null };
  },

  // Instant transfer: moves the stock immediately (source decremented, dest
  // incremented, in one transaction) and records it as 'completed' straight
  // away — no separate confirmation step.
  async transferStock(branchOwnerId: string, body: {
      source_salon_id: string; dest_salon_id: string; source_product_id: string;
      dest_product_id?: string; quantity: number; reason?: string;
  }) {
      const { source_salon_id, dest_salon_id, source_product_id, quantity } = body;
      if (source_salon_id === dest_salon_id) throw new AppError(400, "Source and destination salon must differ", "VALIDATION_ERROR");
      if (!(quantity > 0)) throw new AppError(400, "Quantity must be greater than zero", "VALIDATION_ERROR");
      await assertSalonsAssigned(branchOwnerId, [source_salon_id, dest_salon_id]);

      const source = await branchOwnerRepository.findProduct(source_product_id, source_salon_id);
      if (!source) throw new AppError(404, "Source product not found", "NOT_FOUND");
      if (quantity > source.amount) {
          throw new AppError(400, `Insufficient stock (available ${source.amount}, requested ${quantity})`, "INSUFFICIENT_STOCK");
      }

      let destProductId = body.dest_product_id;
      if (destProductId) {
          const dest = await branchOwnerRepository.findProduct(destProductId, dest_salon_id);
          if (!dest) throw new AppError(404, "Destination product not found", "NOT_FOUND");
      } else {
          // No match picked — create the equivalent product in the destination salon.
          const created = await branchOwnerRepository.createProductInSalon(dest_salon_id, {
              name: source.name,
              barcode: source.barcode,
              measure_unit: source.measure_unit,
              category_id: null, // categories are salon-scoped too — can't carry the source's id across
              supplier_id: null, // same for suppliers
              supply_price: source.supply_price,
              retail_price: source.retail_price,
              markup_percentage: source.markup_percentage,
          });
          destProductId = created.id;
      }

      const client = await pool.connect();
      try {
          await client.query("BEGIN");
          await branchOwnerRepository.executeTransfer(client, source_product_id, destProductId, quantity);
          await client.query("COMMIT");
      } catch (err) {
          await client.query("ROLLBACK");
          throw err;
      } finally {
          client.release();
      }

      return branchOwnerRepository.recordTransfer(branchOwnerId, {
          source_salon_id, dest_salon_id, source_product_id, dest_product_id: destProductId,
          product_name: source.name, quantity, reason: body.reason?.trim() || null,
          status: "completed",
      });
  },

  // Actually moves the stock: re-validates available quantity at the source
  // (it may have changed since the transfer was requested) inside the same
  // transaction as the update, then marks the transfer completed.
  async completeTransfer(branchOwnerId: string, transferId: string) {
      const transfer = await branchOwnerRepository.findTransfer(transferId, branchOwnerId);
      if (!transfer) throw new AppError(404, "Transfer not found", "NOT_FOUND");
      if (transfer.status !== "pending") throw new AppError(409, `Cannot complete a transfer in status "${transfer.status}"`, "INVALID_TRANSITION");

      const source = await branchOwnerRepository.findProduct(transfer.source_product_id, transfer.source_salon_id);
      if (!source || Number(transfer.quantity) > source.amount) {
          throw new AppError(400, `Insufficient stock at source (available ${source?.amount ?? 0}, requested ${transfer.quantity})`, "INSUFFICIENT_STOCK");
      }

      const client = await pool.connect();
      try {
          await client.query("BEGIN");
          await branchOwnerRepository.executeTransfer(client, transfer.source_product_id, transfer.dest_product_id, Number(transfer.quantity));
          await client.query("COMMIT");
      } catch (err) {
          await client.query("ROLLBACK");
          throw err;
      } finally {
          client.release();
      }

      return branchOwnerRepository.setTransferStatus(transferId, "completed");
  },

  async cancelTransfer(branchOwnerId: string, transferId: string) {
      const transfer = await branchOwnerRepository.findTransfer(transferId, branchOwnerId);
      if (!transfer) throw new AppError(404, "Transfer not found", "NOT_FOUND");
      if (transfer.status !== "pending") throw new AppError(409, `Cannot cancel a transfer in status "${transfer.status}"`, "INVALID_TRANSITION");
      return branchOwnerRepository.setTransferStatus(transferId, "cancelled");
  },

  async listTransfers(branchOwnerId: string, status?: string) {
      return branchOwnerRepository.listTransfers(branchOwnerId, status);
  },

  async getInventorySummary(branchOwnerId: string) {
      return branchOwnerRepository.getInventorySummary(branchOwnerId);
  },

  async getBranchOverview(branchOwnerId: string) {
      return branchOwnerRepository.getBranchOverview(branchOwnerId);
  },

  async getLowStockAlerts(branchOwnerId: string) {
      return branchOwnerRepository.getLowStockAlerts(branchOwnerId);
  },

  async getCategoryBreakdown(branchOwnerId: string) {
      return branchOwnerRepository.getCategoryBreakdown(branchOwnerId);
  },

  async getProductsByCategory(branchOwnerId: string, categoryName: string) {
      return branchOwnerRepository.getProductsByCategory(branchOwnerId, categoryName);
  },

  // ── Multi-Branch Finance ──────────────────────────────────────────────────

  async getFinanceOverview(branchOwnerId: string) {
      const salons = await branchOwnerRepository.getMySalons(branchOwnerId);
      const rows = await Promise.all(salons.map(async (salon: any) => {
          const [summary, commission] = await Promise.all([
              salonDashboardRepository.getSummary(salon.id),
              staffCommissionsService.getSalonSummary(salon.id),
          ]);
          return {
              salonId: salon.id,
              salonName: salon.name,
              totalRevenue: summary.totalRevenue,
              allTimeRevenue: summary.allTimeRevenue,
              todayRevenue: summary.todayRevenue,
              totalCommission: commission.total_commission,
              pendingPayout: commission.pending_payout,
              paidOut: commission.paid_out,
          };
      }));
      const totals = rows.reduce((acc, r) => ({
          totalRevenue: acc.totalRevenue + r.totalRevenue,
          allTimeRevenue: acc.allTimeRevenue + r.allTimeRevenue,
          todayRevenue: acc.todayRevenue + r.todayRevenue,
          totalCommission: acc.totalCommission + r.totalCommission,
          pendingPayout: acc.pendingPayout + r.pendingPayout,
          paidOut: acc.paidOut + r.paidOut,
      }), { totalRevenue: 0, allTimeRevenue: 0, todayRevenue: 0, totalCommission: 0, pendingPayout: 0, paidOut: 0 });
      return { salons: rows, totals };
  },

  async getCashManagementOverview(branchOwnerId: string) {
      const rows = await branchOwnerRepository.getCashManagementBySalon(branchOwnerId);
      const salons = rows.map((r: any) => ({
          salonId: r.salon_id,
          salonName: r.salon_name,
          openingBalance: Math.round(Number(r.total_opening_balance ?? 0)),
          cashRevenue: Math.round(Number(r.total_cash_revenue ?? 0)),
          cashExpense: Math.round(Number(r.total_cash_expense ?? 0)),
          closingBalance: Math.round(Number(r.total_closing_balance ?? 0)),
          reconciliationAmount: Math.round(Number(r.total_reconciliation_amount ?? 0)),
          totalSessions: Number(r.total_sessions ?? 0),
          openSessions: Number(r.open_sessions ?? 0),
          closedSessions: Number(r.closed_sessions ?? 0),
      }));
      const totals = salons.reduce((acc, r) => ({
          openingBalance: acc.openingBalance + r.openingBalance,
          cashRevenue: acc.cashRevenue + r.cashRevenue,
          cashExpense: acc.cashExpense + r.cashExpense,
          closingBalance: acc.closingBalance + r.closingBalance,
          reconciliationAmount: acc.reconciliationAmount + r.reconciliationAmount,
          totalSessions: acc.totalSessions + r.totalSessions,
          openSessions: acc.openSessions + r.openSessions,
          closedSessions: acc.closedSessions + r.closedSessions,
      }), { openingBalance: 0, cashRevenue: 0, cashExpense: 0, closingBalance: 0, reconciliationAmount: 0, totalSessions: 0, openSessions: 0, closedSessions: 0 });
      return { salons, totals };
  },

  async getSalonStaffCommissions(branchOwnerId: string, salonId: string, status?: string) {
      await assertSalonsAssigned(branchOwnerId, [salonId]);
      return staffCommissionsService.getEarnedBySalon(salonId, undefined, undefined, undefined, undefined, undefined, status);
  },

  async settleStaffCommission(branchOwnerId: string, salonId: string, staffId: string, amount: number) {
      await assertSalonsAssigned(branchOwnerId, [salonId]);
      if (!(amount > 0)) throw new AppError(400, "Settlement amount must be greater than zero", "VALIDATION_ERROR");
      return staffCommissionsService.settleStaffCommission(salonId, staffId, amount, branchOwnerId);
  },

  // ── Staff Performance Across Branches ─────────────────────────────────────

  async getStaffPerformance(branchOwnerId: string) {
      const salons = await branchOwnerRepository.getMySalons(branchOwnerId);
      const perSalon = await Promise.all(salons.map(async (salon: any) => {
          const [revenue, commission] = await Promise.all([
              salonDashboardRepository.getStaffRevenue(salon.id),
              staffCommissionsService.getEarnedBySalon(salon.id),
          ]);
          const commissionByStaff = new Map(commission.map((c: any) => [c.staff_id, c]));
          return revenue.map((r: any) => {
              const c: any = commissionByStaff.get(r.id);
              return {
                  staffId: r.id,
                  name: r.name,
                  role: r.role,
                  salonId: salon.id,
                  salonName: salon.name,
                  revenue: r.revenue,
                  commissionEarned: c?.total_earned ?? 0,
                  pendingPayout: c?.pending_payout ?? 0,
                  paidOut: c?.paid_out ?? 0,
                  transactionCount: c?.transaction_count ?? 0,
              };
          });
      }));
      return perSalon.flat();
  },

  async enterSalon(branchOwnerId: string, salonId: string) {
    const isAssigned = await branchOwnerRepository.isSalonAssignedToBranchOwner(branchOwnerId, salonId);
    if (!isAssigned) throw new AppError(403, "Salon not assigned to you", "FORBIDDEN");

    const ownerId = await superAdminRepository.getSalonOwnerId(salonId);
    if (!ownerId) throw new AppError(404, "Salon or owner not found", "NOT_FOUND");
    if (!ACCESS_SECRET) throw new AppError(500, "JWT config missing", "SERVER_ERROR");

    const token = jwt.sign(
      { userId: ownerId, role: "salon_owner", salonId, impersonatedBy: "branch_owner" },
      ACCESS_SECRET,
      { expiresIn: "1h" } as any
    );
    return { token, isOnboardingComplete: true };
  },

};
