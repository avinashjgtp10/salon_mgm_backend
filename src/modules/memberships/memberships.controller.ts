import { NextFunction, Request, Response } from "express";
import { membershipsService } from "./memberships.service";
import { sendSuccess } from "../utils/response.util";

export const membershipsController = {

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await membershipsService.list(req.query);
      return sendSuccess(res, 200, data, "Memberships fetched successfully");
    } catch (e) { return next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await membershipsService.create(req.body);
      return sendSuccess(res, 201, data, "Membership created successfully");
    } catch (e) { return next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const data = await membershipsService.getById(id);
      return sendSuccess(res, 200, data, "Membership fetched successfully");
    } catch (e) { return next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const data = await membershipsService.update(id, req.body);
      return sendSuccess(res, 200, data, "Membership updated successfully");
    } catch (e) { return next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await membershipsService.delete(id);
      return sendSuccess(res, 200, {}, "Membership deleted successfully");
    } catch (e) { return next(e); }
  },
};