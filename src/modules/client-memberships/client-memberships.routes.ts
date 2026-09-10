import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { requireSalon } from '../../middleware/salon.middleware';
import { requirePermission, requireAnyPermission } from '../../middleware/permission.middleware';
import { clientMembershipsController } from './client-memberships.controller';

const router = Router();
// Previously only [authMiddleware, requireSalon] — same gap as
// client-packages.routes.ts, closed the same way.
const auth = [authMiddleware, requireSalon, roleMiddleware('salon_owner', 'admin', 'staff')];
const managePurchaseHistory = requirePermission('manage_client_purchase_history');
// Reads also accept plain view_clients — useClientMembershipWallet fetches
// this list for ANY selected client (eWallet/membership-balance display
// during Quick Sale/Calendar checkout), which is routine client-viewing,
// not "managing" their purchase history. Requiring the stronger manage
// permission here blocked any staff who could process a sale but wasn't
// separately granted manage_client_purchase_history the moment they picked
// a client with a membership.
const readPurchaseHistory = requireAnyPermission(['view_clients', 'manage_client_purchase_history']);

router.get('/',              ...auth, readPurchaseHistory, clientMembershipsController.list);
router.post('/',             ...auth, managePurchaseHistory, clientMembershipsController.purchase);
router.post('/sync',         ...auth, managePurchaseHistory, clientMembershipsController.sync);
router.get('/debug',         ...auth, managePurchaseHistory, clientMembershipsController.debug);
router.get('/:id',           ...auth, readPurchaseHistory, clientMembershipsController.getById);
router.patch('/:id/consume', ...auth, managePurchaseHistory, clientMembershipsController.consume);
router.patch('/:id/cancel',  ...auth, managePurchaseHistory, clientMembershipsController.cancel);

export default router;
