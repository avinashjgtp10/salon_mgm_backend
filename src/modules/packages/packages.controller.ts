import { NextFunction, Request, Response } from "express";
import { packagesService } from "./packages.service";
import { sendSuccess } from "../utils/response.util";

export const packagesController = {

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await packagesService.list(req.query as any);
      return sendSuccess(res, 200, data, "Packages fetched successfully");
    } catch (e) { return next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await packagesService.create(req.body);
      return sendSuccess(res, 201, data, "Package created successfully");
    } catch (e) { return next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await packagesService.getById(req.params.id as string);
      return sendSuccess(res, 200, data, "Package fetched successfully");
    } catch (e) { return next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await packagesService.update(req.params.id as string, req.body);
      return sendSuccess(res, 200, data, "Package updated successfully");
    } catch (e) { return next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await packagesService.delete(req.params.id as string);
      return sendSuccess(res, 200, {}, "Package deleted successfully");
    } catch (e) { return next(e); }
  },

  // ── Exports ────────────────────────────────────────────────────────────────

  async exportCsv(req: Request, res: Response, next: NextFunction) {
    try {
      const csv = await packagesService.exportCsv(req.query as any);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="packages_${Date.now()}.csv"`);
      return res.send(csv);
    } catch (e) { return next(e); }
  },

  async exportExcel(req: Request, res: Response, next: NextFunction) {
    try {
      const buffer = await packagesService.exportExcel(req.query as any);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="packages_${Date.now()}.xlsx"`);
      return res.send(buffer);
    } catch (e) { return next(e); }
  },

  async exportPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const buffer = await packagesService.exportPdf(req.query as any);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="packages_${Date.now()}.pdf"`);
      return res.send(buffer);
    } catch (e) { return next(e); }
  },
};
