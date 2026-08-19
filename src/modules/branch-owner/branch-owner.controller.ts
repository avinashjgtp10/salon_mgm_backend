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

};
