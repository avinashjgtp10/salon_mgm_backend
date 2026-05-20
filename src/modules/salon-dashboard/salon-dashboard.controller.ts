import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response.util";
import { salonDashboardService } from "./salon-dashboard.service";
import { getSalonId } from "../utils/salon.util";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const salonDashboardController = {
  async getSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await salonDashboardService.getSummary(salonId);
      return sendSuccess(res, 200, data, "Dashboard summary fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getTodayAppointments(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const date = typeof req.query.date === "string" ? req.query.date : undefined;
      const data = await salonDashboardService.getTodayAppointments(salonId, date);
      return sendSuccess(res, 200, data, "Today's appointments fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getRevenueChart(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const period = typeof req.query.period === "string" ? req.query.period : undefined;
      const data = await salonDashboardService.getRevenueChart(salonId, period);
      return sendSuccess(res, 200, data, "Revenue chart data fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getTopStaff(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await salonDashboardService.getTopStaff(salonId);
      return sendSuccess(res, 200, data, "Top staff fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getServiceMix(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await salonDashboardService.getServiceMix(salonId);
      return sendSuccess(res, 200, data, "Service mix fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const period = typeof req.query.period === "string" ? req.query.period : undefined;
      const date   = typeof req.query.date   === "string" ? req.query.date   : undefined;
      const data   = await salonDashboardService.getAll(salonId, period, date);
      return sendSuccess(res, 200, data, "Dashboard data fetched successfully");
    } catch (err) {
      return next(err);
    }
  },
};
