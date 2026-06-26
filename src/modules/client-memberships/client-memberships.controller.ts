import type { NextFunction, Request, Response } from 'express';
import { clientMembershipsService } from './client-memberships.service';
import { sendSuccess } from '../utils/response.util';
import { AppError } from '../../middleware/error.middleware';

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
  return salonId;
};

export const clientMembershipsController = {

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await clientMembershipsService.list(salonId, {
        clientId: req.query.clientId as string | undefined,
        status:   req.query.status   as string | undefined,
        search:   req.query.search   as string | undefined,
        page:     req.query.page  ? Number(req.query.page)  : undefined,
        limit:    req.query.limit ? Number(req.query.limit) : undefined,
      });
      return sendSuccess(res, 200, data, 'Sold memberships fetched');
    } catch (e) { return next(e); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await clientMembershipsService.getById(req.params.id as string, salonId);
      if (!data) return next(new AppError(404, 'Not found', 'NOT_FOUND'));
      return sendSuccess(res, 200, data, 'Sold membership fetched');
    } catch (e) { return next(e); }
  },

  async purchase(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await clientMembershipsService.purchase(salonId, req.body);
      return sendSuccess(res, 201, data, 'Membership purchased');
    } catch (e) { return next(e); }
  },

  async consume(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await clientMembershipsService.consume(req.params.id as string, salonId, req.body);
      return sendSuccess(res, 200, data, 'Session consumed');
    } catch (e: any) {
      if (
        e.message?.includes('Insufficient') ||
        e.message?.includes('exhausted')    ||
        e.message?.includes('cancelled')    ||
        e.message?.includes('expired')
      ) {
        return next(new AppError(422, e.message, 'SESSION_LIMIT'));
      }
      return next(e);
    }
  },

  async cancel(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const ok = await clientMembershipsService.cancel(req.params.id as string, salonId);
      if (!ok) return next(new AppError(404, 'Not found or already cancelled', 'NOT_FOUND'));
      return sendSuccess(res, 200, { message: 'Membership cancelled' }, 'Cancelled');
    } catch (e) { return next(e); }
  },

  async sync(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const result = await clientMembershipsService.syncFromAppointments(salonId);
      return sendSuccess(res, 200, result, `Sync complete: ${result.created} created, ${result.skipped} skipped`);
    } catch (e) { return next(e); }
  },

  async debug(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const result = await clientMembershipsService.debugInfo(salonId);
      return sendSuccess(res, 200, result, 'Debug info');
    } catch (e) { return next(e); }
  },
};
