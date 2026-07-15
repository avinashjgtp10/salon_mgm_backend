import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { couponsService } from './coupons.service';
import { couponsRepository } from './coupons.repository';

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const couponsController = {

  async validate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { code, orderAmount } = req.body;
      const salonId = req.user?.salonId ?? undefined; // from JWT; optional for global coupons
      if (!code || typeof code !== 'string')
        throw new AppError(400, 'code is required', 'VALIDATION_ERROR');
      if (typeof orderAmount !== 'number' || orderAmount <= 0)
        throw new AppError(400, 'orderAmount must be a positive number', 'VALIDATION_ERROR');

      const result = await couponsService.validate({
        code: code.trim().toUpperCase(),
        orderAmount,
        salonId,
      });
      return sendSuccess(res, 200, result, result.message);
    } catch (err) { return next(err); }
  },

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const coupons = await couponsRepository.list(salonId);
      return sendSuccess(res, 200, coupons, 'Coupons fetched successfully');
    } catch (err) { return next(err); }
  },

  // ---------------- MANAGEMENT (Settings → Coupons) ----------------
  async listOwn(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const coupons = await couponsService.listOwn(salonId);
      return sendSuccess(res, 200, coupons, 'Coupons fetched successfully');
    } catch (err) { return next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const coupon = await couponsService.create(req.body, salonId);
      return sendSuccess(res, 201, coupon, 'Coupon created successfully');
    } catch (err) { return next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const coupon = await couponsService.update(String(req.params.id), req.body, salonId);
      return sendSuccess(res, 200, coupon, 'Coupon updated successfully');
    } catch (err) { return next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      await couponsService.remove(String(req.params.id), salonId);
      return sendSuccess(res, 200, null, 'Coupon deleted successfully');
    } catch (err) { return next(err); }
  },

  async removeBatch(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const deleted = await couponsService.removeBatch(String(req.params.batchId), salonId);
      return sendSuccess(res, 200, { deleted }, `${deleted} coupons deleted successfully`);
    } catch (err) { return next(err); }
  },

  async createBulk(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const coupons = await couponsService.createBulk(req.body, salonId);
      return sendSuccess(res, 201, coupons, `${coupons.length} coupons created successfully`);
    } catch (err) { return next(err); }
  },
};
