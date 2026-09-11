import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { requireSalon } from '../../middleware/salon.middleware';
import { requireAnyPermission } from '../../middleware/permission.middleware';
import { clientMembershipsController } from './client-memberships.controller';

const router = Router();
// Previously only [authMiddleware, requireSalon] — same gap as
// client-packages.routes.ts, closed the same way. manage_client_purchase_history
// (a dedicated fine-grained permission for purchase/sync/consume/cancel) was
// tried and then removed — these writes are role-only now (owner/admin/
// staff), same as most other Warehouse-adjacent actions in this app.
const auth = [authMiddleware, requireSalon, roleMiddleware('salon_owner', 'admin', 'staff')];
// Reads accept view_clients or view_appointment — useClientMembershipWallet
// fetches this list for ANY selected client (eWallet/membership-balance
// display during Quick Sale/Calendar checkout, or inside View Appointment),
// which is routine client-viewing.
const readPurchaseHistory = requireAnyPermission(['view_clients', 'view_appointment']);

router.get('/',              ...auth, readPurchaseHistory, clientMembershipsController.list);
router.post('/',             ...auth, clientMembershipsController.purchase);
router.post('/sync',         ...auth, clientMembershipsController.sync);
router.get('/debug',         ...auth, clientMembershipsController.debug);
router.get('/:id',           ...auth, readPurchaseHistory, clientMembershipsController.getById);
router.patch('/:id/consume', ...auth, clientMembershipsController.consume);
router.patch('/:id/cancel',  ...auth, clientMembershipsController.cancel);

export default router;
