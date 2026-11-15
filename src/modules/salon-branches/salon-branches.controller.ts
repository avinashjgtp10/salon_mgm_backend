import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { getSalonId } from '../utils/tenant.util';
import { salonBranchesService, type BranchCtx } from './salon-branches.service';

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null; impersonatedBy?: string | null } };

// A salon owner acts for their salon; a Branch Owner (role branch_owner) has no salon of their own and connects salons to themselves.
const ctxOf = (req: AuthRequest): BranchCtx => ({
  userId: req.user!.userId,
  kind: req.user?.role === "branch_owner" ? "branchOwner" : "owner",
  salonId: req.user?.role === "branch_owner" ? "" : getSalonId(req),
  impersonatedBy: req.user?.impersonatedBy ?? null,
  ip: String((req as any).ip || ''),
  userAgent: String(req.headers['user-agent'] || ''),
});

const idParam = (req: Request) => {
  const id = String(req.params.id || '').trim();
  if (!id) throw new AppError(400, 'id is required', 'VALIDATION_ERROR');
  return id;
};

export const salonBranchesController = {
  async verify(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await salonBranchesService.verify(ctxOf(req), req.body?.email, req.body?.password);
      return sendSuccess(res, 200, data, 'Account verified');
    } catch (err) { return next(err); }
  },

  async connect(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await salonBranchesService.connect(ctxOf(req), req.body?.verifyToken);
      return sendSuccess(res, 201, data, 'Branch connected');
    } catch (err) { return next(err); }
  },

  async createLogin(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await salonBranchesService.createBranchLogin(ctxOf(req), req.body?.username, req.body?.password);
      return sendSuccess(res, 201, data, 'Branch login created');
    } catch (err) { return next(err); }
  },

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, 200, await salonBranchesService.list(ctxOf(req)), 'Branches fetched successfully');
    } catch (err) { return next(err); }
  },

  async portalStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, 200, await salonBranchesService.portalStatus(ctxOf(req)), 'Portal status fetched successfully');
    } catch (err) { return next(err); }
  },

  async updateLogin(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, 200, await salonBranchesService.updateLogin(ctxOf(req), req.body ?? {}), 'Branch login updated');
    } catch (err) { return next(err); }
  },

  async disconnect(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, 200, await salonBranchesService.disconnect(ctxOf(req), idParam(req)), 'Branch disconnected');
    } catch (err) { return next(err); }
  },

  async openPortal(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, 200, await salonBranchesService.openPortal(ctxOf(req)), 'Branch portal opened');
    } catch (err) { return next(err); }
  },
};
