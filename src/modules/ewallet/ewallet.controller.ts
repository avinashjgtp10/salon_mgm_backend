import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { ewalletService } from './ewallet.service';
import { TopUpEwalletBody } from './ewallet.types';

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const ewalletController = {

  async topUp(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const salonId = req.user?.salonId;
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');

      const clientId = String(req.params.clientId || '').trim();
      if (!clientId) throw new AppError(400, 'clientId is required', 'VALIDATION_ERROR');

      const body = req.body as TopUpEwalletBody;
      const result = await ewalletService.topUp(clientId, salonId, Number(body.amount), body.note, userId);
      return sendSuccess(res, 201, result, 'eWallet topped up successfully');
    } catch (err) { return next(err); }
  },

  async getBalance(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const clientId = String(req.params.clientId || '').trim();
      if (!clientId) throw new AppError(400, 'clientId is required', 'VALIDATION_ERROR');
      const result = await ewalletService.getBalance(clientId, salonId);
      return sendSuccess(res, 200, result, 'eWallet balance fetched successfully');
    } catch (err) { return next(err); }
  },

  async listLedger(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const clientId = String(req.params.clientId || '').trim();
      if (!clientId) throw new AppError(400, 'clientId is required', 'VALIDATION_ERROR');
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const result = await ewalletService.listLedger(clientId, salonId, limit);
      return sendSuccess(res, 200, result, 'eWallet ledger fetched successfully');
    } catch (err) { return next(err); }
  },
};
