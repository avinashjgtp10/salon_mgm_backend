import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { couponsController } from './coupons.controller';

const router = Router();
// Previously any staff had full CRUD with zero permission check — closed
// via view_coupons/manage_coupons.
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff');
const viewCoupons = requirePermission('view_coupons');
const manageCoupons = requirePermission('manage_coupons');

// Validate stays open to any authenticated user — it's a read-only "is this
// code valid" check used at checkout, not a management action.
router.post('/validate', authMiddleware, couponsController.validate);
router.get('/', authMiddleware, ownerAdminStaff, viewCoupons, couponsController.list);

// ---------------- MANAGEMENT (Settings → Coupons) ----------------
router.get('/mine', authMiddleware, ownerAdminStaff, viewCoupons, couponsController.listOwn);
router.post('/', authMiddleware, ownerAdminStaff, manageCoupons, couponsController.create);
router.post('/bulk', authMiddleware, ownerAdminStaff, manageCoupons, couponsController.createBulk);
router.patch('/:id', authMiddleware, ownerAdminStaff, manageCoupons, couponsController.update);
router.delete('/batch/:batchId', authMiddleware, ownerAdminStaff, manageCoupons, couponsController.removeBatch);
router.delete('/:id', authMiddleware, ownerAdminStaff, manageCoupons, couponsController.remove);

export default router;
