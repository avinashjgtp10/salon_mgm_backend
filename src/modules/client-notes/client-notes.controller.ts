import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { clientNotesService } from "./client-notes.service";
import { CreateClientNoteBody, UpdateClientNoteBody } from "./client-notes.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return salonId;
};

export const clientNotesController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const clientId = String(req.params.clientId || "").trim();
      const data = await clientNotesService.list(clientId, getSalonId(req));
      return sendSuccess(res, 200, data, "Client notes fetched successfully");
    } catch (err) { return next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const clientId = String(req.params.clientId || "").trim();
      const staffId = req.user?.userId ?? null;
      const data = await clientNotesService.create(clientId, getSalonId(req), staffId, req.body as CreateClientNoteBody);
      return sendSuccess(res, 201, data, "Note added successfully");
    } catch (err) { return next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const clientId = String(req.params.clientId || "").trim();
      const data = await clientNotesService.update(clientId, getSalonId(req), String(req.params.id), req.body as UpdateClientNoteBody);
      return sendSuccess(res, 200, data, "Note updated successfully");
    } catch (err) { return next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const clientId = String(req.params.clientId || "").trim();
      await clientNotesService.delete(clientId, getSalonId(req), String(req.params.id));
      return sendSuccess(res, 200, null, "Note deleted");
    } catch (err) { return next(err); }
  },
};
