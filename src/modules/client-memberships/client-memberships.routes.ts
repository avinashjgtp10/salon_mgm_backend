import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { requireSalon } from '../../middleware/salon.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { clientMembershipsController } from './client-memberships.controller';

const router = Router();
// Previously only [authMiddleware, requireSalon] — same gap as
// client-packages.routes.ts, closed the same way.
const auth = [authMiddleware, requireSalon, roleMiddleware('salon_owner', 'admin', 'staff')];
const managePurchaseHistory = requirePermission('manage_client_purchase_history');

router.get('/',              ...auth, managePurchaseHistory, clientMembershipsController.list);
router.post('/',             ...auth, managePurchaseHistory, clientMembershipsController.purchase);
router.post('/sync',         ...auth, managePurchaseHistory, clientMembershipsController.sync);
router.get('/debug',         ...auth, managePurchaseHistory, clientMembershipsController.debug);
router.get('/:id',           ...auth, managePurchaseHistory, clientMembershipsController.getById);
router.patch('/:id/consume', ...auth, managePurchaseHistory, clientMembershipsController.consume);
router.patch('/:id/cancel',  ...auth, managePurchaseHistory, clientMembershipsController.cancel);

export default router;
