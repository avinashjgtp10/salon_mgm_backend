import { NextFunction, Request, Response } from "express";
import { packagesService } from "./packages.service";
import { sendSuccess } from "../utils/response.util";
import { AppError } from "../../middleware/error.middleware";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return salonId;
};

export const packagesController = {

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await packagesService.list({ ...req.query as any, salonId });
      return sendSuccess(res, 200, data, "Packages fetched successfully");
    } catch (e) { return next(e); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await packagesService.create({ ...req.body, salonId });
      return sendSuccess(res, 201, data, "Package created successfully");
    } catch (e) { return next(e); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await packagesService.getById(String(req.params.id), salonId);
      return sendSuccess(res, 200, data, "Package fetched successfully");
    } catch (e) { return next(e); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await packagesService.update(String(req.params.id), salonId, req.body);
      return sendSuccess(res, 200, data, "Package updated successfully");
    } catch (e) { return next(e); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      await packagesService.delete(String(req.params.id), salonId);
      return sendSuccess(res, 200, {}, "Package deleted successfully");
    } catch (e) { return next(e); }
  },

  // ── Exports ────────────────────────────────────────────────────────────────

  async exportCsv(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const csv = await packagesService.exportCsv({ ...req.query as any, salonId });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="packages_${Date.now()}.csv"`);
      return res.send(csv);
    } catch (e) { return next(e); }
  },

  async exportExcel(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const buffer = await packagesService.exportExcel({ ...req.query as any, salonId });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="packages_${Date.now()}.xlsx"`);
      return res.send(buffer);
    } catch (e) { return next(e); }
  },

  async exportPdf(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const buffer = await packagesService.exportPdf({ ...req.query as any, salonId });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="packages_${Date.now()}.pdf"`);
      return res.send(buffer);
    } catch (e) { return next(e); }
  },
};

