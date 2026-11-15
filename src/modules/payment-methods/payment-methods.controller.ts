import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { getSalonId } from '../utils/tenant.util';
import { paymentMethodsService } from './payment-methods.service';

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const paymentMethodsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, 200, await paymentMethodsService.list(getSalonId(req)), 'Payment methods fetched successfully');
    } catch (err) { return next(err); }
  },

  async listActive(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, 200, await paymentMethodsService.listActive(getSalonId(req)), 'Active payment methods fetched successfully');
    } catch (err) { return next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const created = await paymentMethodsService.create(getSalonId(req), req.body ?? {}, req.user?.userId ?? null);
      return sendSuccess(res, 201, created, 'Payment method created successfully');
    } catch (err) { return next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) throw new AppError(400, 'id is required', 'VALIDATION_ERROR');
      const updated = await paymentMethodsService.update(id, getSalonId(req), req.body ?? {});
      return sendSuccess(res, 200, updated, 'Payment method updated successfully');
    } catch (err) { return next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) throw new AppError(400, 'id is required', 'VALIDATION_ERROR');
      const removed = await paymentMethodsService.remove(id, getSalonId(req));
      return sendSuccess(res, 200, removed, 'Payment method deleted successfully');
    } catch (err) { return next(err); }
  },

  async listBuiltIns(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, 200, await paymentMethodsService.listBuiltIns(getSalonId(req)), 'Built-in payment methods fetched successfully');
    } catch (err) { return next(err); }
  },

  async setBuiltInActive(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const key = String(req.params.key || '').trim();
      const updated = await paymentMethodsService.setBuiltInActive(getSalonId(req), key, req.body?.is_active, req.user?.userId ?? null);
      return sendSuccess(res, 200, updated, 'Payment method updated successfully');
    } catch (err) { return next(err); }
  },
};
