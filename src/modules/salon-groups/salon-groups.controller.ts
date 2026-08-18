import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response.util";
import { salonGroupsService } from "./salon-groups.service";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string | null };
};

export const salonGroupsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const data = await salonGroupsService.list(search);
      sendSuccess(res, 200, data, "Salon groups fetched successfully");
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, owner_id } = req.body ?? {};
      const data = await salonGroupsService.create(name, owner_id);
      sendSuccess(res, 201, data, "Salon group created successfully");
    } catch (err) { next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await salonGroupsService.delete(String(req.params.id));
      sendSuccess(res, 200, data, "Salon group deleted successfully");
    } catch (err) { next(err); }
  },

  async addSalon(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { salon_id } = req.body ?? {};
      const data = await salonGroupsService.addSalon(String(req.params.id), salon_id);
      sendSuccess(res, 200, data, "Salon added to group successfully");
    } catch (err) { next(err); }
  },

  async removeSalon(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await salonGroupsService.removeSalon(String(req.params.id), String(req.params.salonId));
      sendSuccess(res, 200, data, "Salon removed from group successfully");
    } catch (err) { next(err); }
  },

  async getUngroupedSalonsForOwner(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const ownerId = typeof req.query.owner_id === "string" ? req.query.owner_id : "";
      const data = await salonGroupsService.getUngroupedSalonsForOwner(ownerId);
      sendSuccess(res, 200, data, "Ungrouped salons fetched successfully");
    } catch (err) { next(err); }
  },

  async setCredentials(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body ?? {};
      const data = await salonGroupsService.setCredentials(String(req.params.id), email, password);
      sendSuccess(res, 200, data, "Branch owner credentials updated successfully");
    } catch (err) { next(err); }
  },
};
