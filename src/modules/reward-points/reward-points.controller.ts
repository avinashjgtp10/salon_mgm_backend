import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { rewardPointsRepository } from './reward-points.repository';

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const rewardPointsController = {

  // GET /api/v1/reward-points/:clientId/ledger — per-transaction earn/redeem/adjust
  // history with running balance, for the Client History "Referrals & Rewards" tab.
  async listLedger(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const clientId = String(req.params.clientId || '').trim();
      if (!clientId) throw new AppError(400, 'clientId is required', 'VALIDATION_ERROR');
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const result = await rewardPointsRepository.listLedger(clientId, limit);
      return sendSuccess(res, 200, result, 'Reward points ledger fetched successfully');
    } catch (err) { return next(err); }
  },
};
