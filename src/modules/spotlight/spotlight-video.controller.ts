import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response.util";
import { spotlightVideoService } from "./spotlight-video.service";

type AuthRequest = Request & { user?: { userId: string } };

export const spotlightVideoController = {
  // Super admin
  async adminList(_req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await spotlightVideoService.listAll()); } catch (err) { return next(err); }
  },
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 201, await spotlightVideoService.create(req.body, req.user!.userId)); } catch (err) { return next(err); }
  },
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await spotlightVideoService.update(String(req.params.id ?? ""), req.body)); } catch (err) { return next(err); }
  },
  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await spotlightVideoService.remove(String(req.params.id ?? ""));
      return sendSuccess(res, 200, { id: String(req.params.id ?? "") });
    } catch (err) { return next(err); }
  },

  // Any salon user: the videos that could play, for the floating player
  async list(_req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await spotlightVideoService.listPlayable()); } catch (err) { return next(err); }
  },
};
