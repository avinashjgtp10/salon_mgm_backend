import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { uploadAvatarToS3 } from "../utils/avatar.upload";
import { assetsService } from "./assets.service";
import { ASSET_CONDITIONS, ASSET_STATUSES, INVESTIGATION_STATUSES, type Actor } from "./assets.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

const actorOf = (req: AuthRequest): Actor => {
  const userId = req.user?.userId;
  const salonId = req.user?.salonId;
  if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return { userId, salonId };
};
const idOf = (req: Request) => {
  const id = String(req.params.id || "").trim();
  if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
  return id;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.includes(v as T) ? (v as T) : undefined;
// "a,b,c" -> ["a","b","c"] (keeps only allowed values when a list is given)
const csv = (v: unknown): string[] =>
  String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
const csvOf = <T extends string>(v: unknown, allowed: readonly T[]): T[] | undefined => {
  const out = csv(v).filter((x): x is T => allowed.includes(x as T));
  return out.length ? out : undefined;
};

export const assetsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { salonId } = actorOf(req);
      const q = req.query;
      const data = await assetsService.list(salonId, {
        search: String(q.search || "").trim() || undefined,
        status: csvOf(q.status, ASSET_STATUSES),
        condition: csvOf(q.condition, ASSET_CONDITIONS),
        category: csv(q.category).length ? csv(q.category) : undefined,
        branch_id: csv(q.branch_id).length ? csv(q.branch_id) : undefined,
        page: Number(q.page) || 1,
        limit: Number(q.limit) || 20,
      });
      return sendSuccess(res, 200, { ...data, page: Number(q.page) || 1, limit: Number(q.limit) || 20 }, "Assets fetched");
    } catch (e) { return next(e); }
  },

  async categories(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.categories(actorOf(req).salonId), "Categories fetched"); }
    catch (e) { return next(e); }
  },

  async addCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 201, await assetsService.addCategory(actorOf(req), req.body ?? {}), "Category added"); }
    catch (e) { return next(e); }
  },

  async deleteCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.deleteCategory(actorOf(req), req.query.name), "Category deleted"); }
    catch (e) { return next(e); }
  },

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.get(actorOf(req).salonId, idOf(req)), "Asset fetched"); }
    catch (e) { return next(e); }
  },

  async history(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.history(actorOf(req).salonId, idOf(req)), "History fetched"); }
    catch (e) { return next(e); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 201, await assetsService.create(actorOf(req), req.body ?? {}), "Asset registered"); }
    catch (e) { return next(e); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.update(actorOf(req), idOf(req), req.body ?? {}), "Asset updated"); }
    catch (e) { return next(e); }
  },

  async issue(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.issue(actorOf(req), idOf(req), req.body ?? {}), "Asset issued"); }
    catch (e) { return next(e); }
  },

  async returnAsset(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.returnAsset(actorOf(req), idOf(req), req.body ?? {}), "Asset returned"); }
    catch (e) { return next(e); }
  },

  async reportIncident(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 201, await assetsService.reportIncident(actorOf(req), idOf(req), req.body ?? {}), "Incident reported"); }
    catch (e) { return next(e); }
  },

  async maintenance(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.maintenance(actorOf(req), idOf(req), req.body ?? {}), "Maintenance updated"); }
    catch (e) { return next(e); }
  },

  async retire(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.retire(actorOf(req), idOf(req), req.body ?? {}), "Asset retired"); }
    catch (e) { return next(e); }
  },

  async clearInspection(req: AuthRequest, res: Response, next: NextFunction) {
    try { return sendSuccess(res, 200, await assetsService.clearInspection(actorOf(req), idOf(req), req.body ?? {}), "Inspection cleared"); }
    catch (e) { return next(e); }
  },

  async listIncidents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query;
      const data = await assetsService.listIncidents(actorOf(req).salonId, {
        status: oneOf(q.status, INVESTIGATION_STATUSES),
        asset_id: String(q.asset_id || "").trim() || undefined,
        open_only: q.open_only === "true",
      });
      return sendSuccess(res, 200, data, "Incidents fetched");
    } catch (e) { return next(e); }
  },

  async updateIncident(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const incidentId = String(req.params.incidentId || "").trim();
      if (!incidentId) throw new AppError(400, "incidentId is required", "VALIDATION_ERROR");
      return sendSuccess(res, 200, await assetsService.updateIncident(actorOf(req), incidentId, req.body ?? {}), "Investigation updated");
    } catch (e) { return next(e); }
  },

  async uploadPhoto(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { salonId } = actorOf(req);
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) throw new AppError(400, "No image file provided", "FILE_REQUIRED");
      const key = `${salonId}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const url = await uploadAvatarToS3(file.path, key, file.mimetype, "assets");
      return sendSuccess(res, 200, { url }, "Photo uploaded");
    } catch (e) { return next(e); }
  },
};
