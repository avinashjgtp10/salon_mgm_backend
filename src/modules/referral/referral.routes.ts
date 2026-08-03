import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { referralController } from './referral.controller';

const router = Router();

router.get(
  '/:clientId/ledger',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  referralController.listLedger
);

export default router;
