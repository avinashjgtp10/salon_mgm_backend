import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validation.middleware';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { guideRepository } from './user-guide.repository';

type AuthRequest = Request & { user?: { userId?: string } };
export const guideStatusSchema = z.object({ status: z.enum(['completed', 'skipped']) }).strict();
// Only main sidebar features have tours. Apps is still Coming Soon.
export const guideFeatureKeys = ['dashboard', 'quick_sale', 'calendar', 'clients', 'catalog', 'inventory', 'staff', 'cash_management', 'marketing', 'online_booking', 'enquiries', 'reports', 'settings', 'spotlight', 'help'] as const;
const router = Router();
router.use(authMiddleware);
// Progress is account-specific, never salon-wide. Identity comes exclusively
// from the verified JWT, including when staff belong to multiple salons.
function userId(req: AuthRequest) {
  if (!req.user?.userId) throw new AppError(401, 'Authenticated user required', 'UNAUTHORIZED');
  return req.user.userId;
}
router.get('/progress', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const progress = await guideRepository.get(userId(req));
    sendSuccess(res, 200, progress, 'Guide progress fetched');
  } catch (error) { next(error); }
});
router.put('/progress/:feature', validateBody(guideStatusSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const feature = String(req.params.feature);
    if (!(guideFeatureKeys as readonly string[]).includes(feature)) throw new AppError(422, 'Unsupported guide feature', 'VALIDATION_ERROR');
    const progress = await guideRepository.save(userId(req), feature, req.body.status);
    sendSuccess(res, 200, progress, 'Guide progress saved');
  } catch (error) { next(error); }
});
export default router;
