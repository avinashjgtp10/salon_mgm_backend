import { Request, Response, NextFunction } from "express";
import { branchOwnerService } from "./branch-owner.service";
import { AppError } from "../../middleware/error.middleware";

type AuthedRequest = Request & { user?: { userId: string } };

export const branchOwnerController = {

  async getMySalons(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const data = await branchOwnerService.getMySalons(branchOwnerId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // Single-call version of the My Salons page — same payload as getMySalons,
  // just POST so the page only ever makes one request on load instead of
  // GET-ing a list plus any incidental follow-ups.
  async listMySalons(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const data = await branchOwnerService.getMySalons(branchOwnerId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getDashboard(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const data = await branchOwnerService.getDashboard(branchOwnerId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getPayments(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const status = req.query.status ? String(req.query.status) : undefined;
      const data = await branchOwnerService.getPayments(branchOwnerId, status);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // Single-call version of the Payments page — same payload as getPayments,
  // just POST with the status filter in the body instead of the query string.
  async listPayments(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const status = req.body?.status ? String(req.body.status) : undefined;
      const data = await branchOwnerService.getPayments(branchOwnerId, status);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async enterSalon(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.params.id);
      const data = await branchOwnerService.enterSalon(branchOwnerId, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async resetSalonOwnerPassword(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.params.id);
      const { password } = req.body ?? {};
      const data = await branchOwnerService.resetSalonOwnerPassword(branchOwnerId, salonId, password);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async deleteSalon(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.params.id);
      const data = await branchOwnerService.deleteSalon(branchOwnerId, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getSalonStaff(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.params.salonId);
      const data = await branchOwnerService.getSalonStaff(branchOwnerId, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // Single-call version of the Staff & Permissions page — combined staff
  // list across every assigned salon, computed server-side in one request.
  async listAllStaff(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const data = await branchOwnerService.getAllStaff(branchOwnerId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async updateSalonStaffPermissions(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.params.salonId);
      const staffId = String(req.params.staffId);
      const { custom_permissions } = req.body ?? {};
      const data = await branchOwnerService.updateSalonStaffPermissions(branchOwnerId, salonId, staffId, custom_permissions ?? null);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getSalonSubscription(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.params.salonId);
      const data = await branchOwnerService.getSalonSubscription(branchOwnerId, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getSalonInvoices(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.params.salonId);
      const data = await branchOwnerService.getSalonInvoices(branchOwnerId, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async listSalonProducts(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.params.salonId);
      const search = req.query.search ? String(req.query.search) : undefined;
      const data = await branchOwnerService.listSalonProducts(branchOwnerId, salonId, search);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async suggestMatch(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const { source_salon_id, source_product_id, dest_salon_id } = req.query as Record<string, string>;
      const data = await branchOwnerService.suggestMatch(branchOwnerId, source_salon_id, source_product_id, dest_salon_id);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async transferStock(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const data = await branchOwnerService.transferStock(branchOwnerId, req.body ?? {});
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async completeTransfer(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const data = await branchOwnerService.completeTransfer(branchOwnerId, String(req.params.id));
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async cancelTransfer(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const data = await branchOwnerService.cancelTransfer(branchOwnerId, String(req.params.id));
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async listTransfers(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const status = req.query.status ? String(req.query.status) : undefined;
      const data = await branchOwnerService.listTransfers(branchOwnerId, status);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getInventorySummary(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const data = await branchOwnerService.getInventorySummary(req.user!.userId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getBranchOverview(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const data = await branchOwnerService.getBranchOverview(req.user!.userId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getLowStockAlerts(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const data = await branchOwnerService.getLowStockAlerts(req.user!.userId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getCategoryBreakdown(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const data = await branchOwnerService.getCategoryBreakdown(req.user!.userId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getProductsByCategory(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const categoryName = String(req.params.categoryName);
      const data = await branchOwnerService.getProductsByCategory(req.user!.userId, categoryName);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── Multi-Branch Finance ──────────────────────────────────────────────────

  async getFinanceOverview(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const data = await branchOwnerService.getFinanceOverview(req.user!.userId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getCashManagementOverview(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const data = await branchOwnerService.getCashManagementOverview(req.user!.userId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getSalonStaffCommissions(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.salonId);
      const status = req.query.status ? String(req.query.status) : undefined;
      const data = await branchOwnerService.getSalonStaffCommissions(req.user!.userId, salonId, status);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async settleStaffCommission(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.salonId);
      const { staff_id, amount } = req.body ?? {};
      const data = await branchOwnerService.settleStaffCommission(req.user!.userId, salonId, String(staff_id), Number(amount));
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── Staff Performance ─────────────────────────────────────────────────────

  async getStaffPerformance(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const period = req.query.period ? String(req.query.period) : undefined;
      const data = await branchOwnerService.getStaffPerformance(req.user!.userId, period);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // Single-call version of the Staff Performance page — same payload as
  // getStaffPerformance, just POST with the period filter in the body.
  async listStaffPerformance(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const period = req.body?.period ? String(req.body.period) : undefined;
      const data = await branchOwnerService.getStaffPerformance(req.user!.userId, period);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async submitSupportTicket(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const { salonId, subject, category, message, priority } = req.body ?? {};
      const data = await branchOwnerService.submitSupportTicket(branchOwnerId, { salonId, subject, category, message, priority });
      return res.status(201).json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async listNotifications(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.query.salonId ?? "");
      if (!salonId) throw new AppError(400, "salonId is required", "VALIDATION_ERROR");
      const data = await branchOwnerService.listNotifications(branchOwnerId, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async unreadNotificationCount(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.query.salonId ?? "");
      if (!salonId) throw new AppError(400, "salonId is required", "VALIDATION_ERROR");
      const count = await branchOwnerService.getUnreadNotificationCount(branchOwnerId, salonId);
      return res.json({ success: true, data: { count } });
    } catch (err) { return next(err); }
  },

  async markNotificationRead(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.body?.salonId ?? "");
      if (!salonId) throw new AppError(400, "salonId is required", "VALIDATION_ERROR");
      const data = await branchOwnerService.markNotificationRead(branchOwnerId, salonId, String(req.params.id));
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async markAllNotificationsRead(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const salonId = String(req.body?.salonId ?? "");
      if (!salonId) throw new AppError(400, "salonId is required", "VALIDATION_ERROR");
      const data = await branchOwnerService.markAllNotificationsRead(branchOwnerId, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

};
