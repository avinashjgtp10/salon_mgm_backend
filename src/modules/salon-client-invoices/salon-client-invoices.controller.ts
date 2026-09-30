import { Request, Response, NextFunction } from "express";
import { salonClientInvoicesService } from "./salon-client-invoices.service";

export const salonClientInvoicesController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.id);
      const filters = salonClientInvoicesService.parseFilters(req.query);
      const data = await salonClientInvoicesService.list(salonId, filters);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async summary(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.id);
      const filters = salonClientInvoicesService.parseFilters(req.query);
      const data = await salonClientInvoicesService.summary(salonId, filters);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async branches(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.id);
      const data = await salonClientInvoicesService.branches(salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async searchClients(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.id);
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const data = await salonClientInvoicesService.searchClients(salonId, q);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async getForPrint(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.id);
      const invoiceId = String(req.params.invoiceId);
      const data = await salonClientInvoicesService.getForPrint(salonId, invoiceId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async create(req: Request & { user?: { userId: string } }, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.params.id);
      const createdByUserId = req.user?.userId ?? null;
      const data = await salonClientInvoicesService.create(salonId, req.body, createdByUserId);
      return res.status(201).json({ success: true, data });
    } catch (err) { return next(err); }
  },
};
