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

// Settings page: the full list (active + inactive), and the writes.
router.get('/',      authMiddleware, ownerAdminStaff, viewManage, paymentMethodsController.list);
router.post('/',     authMiddleware, ownerAdminStaff, manage,     paymentMethodsController.create);
router.put('/:id',   authMiddleware, ownerAdminStaff, manage,     paymentMethodsController.update);

export default router;
