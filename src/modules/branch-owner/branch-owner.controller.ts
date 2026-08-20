import { Request, Response, NextFunction } from "express";
import { branchOwnerService } from "./branch-owner.service";

type AuthedRequest = Request & { user?: { userId: string } };

export const branchOwnerController = {

  async getMySalons(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const data = await branchOwnerService.getMySalons(branchOwnerId);
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
      const data = await branchOwnerService.getStaffPerformance(req.user!.userId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── Membership Sharing ─────────────────────────────────────────────────────

  async listSalonMemberships(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.salonId);
      const data = await branchOwnerService.listSalonMemberships(req.user!.userId, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async copyMembership(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const { source_salon_id, dest_salon_id, membership_id } = req.body ?? {};
      const data = await branchOwnerService.copyMembership(branchOwnerId, String(source_salon_id), String(dest_salon_id), String(membership_id));
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  // ── Package Sharing ────────────────────────────────────────────────────────

  async listSalonPackages(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.salonId);
      const data = await branchOwnerService.listSalonPackages(req.user!.userId, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async copyPackage(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const branchOwnerId = req.user!.userId;
      const { source_salon_id, dest_salon_id, template_id } = req.body ?? {};
      const data = await branchOwnerService.copyPackage(branchOwnerId, String(source_salon_id), String(dest_salon_id), String(template_id));
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

};
