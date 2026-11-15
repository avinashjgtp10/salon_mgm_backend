import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { requirePermission, requireAnyPermission } from '../../middleware/permission.middleware';
import { paymentMethodsController } from './payment-methods.controller';

const router = Router();
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff');
const viewManage = requireAnyPermission(['manage_payment_methods', 'view_settings_payment_methods']);
const manage = requirePermission('manage_payment_methods');

// Checkout screens (Calendar, Quick Sale, Package purchase) need the active
// names to offer them — just names, so no settings permission is required.
router.get('/active', authMiddleware, ownerAdminStaff, paymentMethodsController.listActive);
// Cash / Card / UPI and whether the salon has switched each off — read by the
// same screens as /active, switched by the settings permission below.
router.get('/built-in',      authMiddleware, ownerAdminStaff,         paymentMethodsController.listBuiltIns);
router.put('/built-in/:key', authMiddleware, ownerAdminStaff, manage, paymentMethodsController.setBuiltInActive);

// Settings page: the full list (active + inactive), and the writes.
router.get('/',      authMiddleware, ownerAdminStaff, viewManage, paymentMethodsController.list);
router.post('/',     authMiddleware, ownerAdminStaff, manage,     paymentMethodsController.create);
router.put('/:id',   authMiddleware, ownerAdminStaff, manage,     paymentMethodsController.update);
router.delete('/:id', authMiddleware, ownerAdminStaff, manage,    paymentMethodsController.remove);

export default router;
