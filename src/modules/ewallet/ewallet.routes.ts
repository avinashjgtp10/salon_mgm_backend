import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { ewalletController } from './ewallet.controller';

const router = Router();

router.post(
  '/:clientId/topup',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  ewalletController.topUp
);
router.get(
  '/:clientId/balance',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  ewalletController.getBalance
);
router.get(
  '/:clientId/ledger',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  ewalletController.listLedger
);
router.get(
  '/:clientId/breakdown',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  ewalletController.getBreakdown
);

export default router;
