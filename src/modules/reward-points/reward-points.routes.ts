import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { rewardPointsController } from './reward-points.controller';

const router = Router();

router.get(
  '/:clientId/ledger',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  rewardPointsController.listLedger
);

export default router;
