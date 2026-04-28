import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { couponsService } from './coupons.service';
import { couponsRepository } from './coupons.repository';

type AuthRequest = Request & { user?: { userId: string; role?: string } };

export const couponsController = {

  async validate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { code, orderAmount, salonId } = req.body;
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
      const salonId = String(req.query.salon_id || '').trim() || undefined;
      const coupons = await couponsRepository.list(salonId);
      return sendSuccess(res, 200, coupons, 'Coupons fetched successfully');
    } catch (err) { return next(err); }
  },
};
