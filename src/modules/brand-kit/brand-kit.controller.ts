import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { brandKitRepository } from './brand-kit.repository';

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string | null };
};

const requireSalon = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
  return salonId;
};

/**
 * Read-only. There is no editor for the brand kit — see PropertyPanel/AssetPanel
 * history on the frontend — so `save`/`uploadLogo` were removed as dead code.
 * This endpoint stays because CouponDesignerPage.tsx still resolves
 * {{Tagline}}/{{Instagram}}/{{Facebook}}/{{WhatsApp}} from it.
 */
export const brandKitController = {
  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const kit = await brandKitRepository.resolve(requireSalon(req));
      return sendSuccess(res, 200, kit, 'Brand kit fetched');
    } catch (err) { return next(err); }
  },
};
