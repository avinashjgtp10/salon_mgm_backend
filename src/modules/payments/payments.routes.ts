import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { paymentsController } from './payments.controller';
import { validateCreatePayment } from './payments.validator';
import { requireAnyPermission } from '../../middleware/permission.middleware';
import { requirePaidBillEditPermission } from '../appointments/appointments.guards';

const router = Router();

router.post(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  validateCreatePayment,
  paymentsController.create
);
router.get(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  paymentsController.listBySalon
);
// Staff need the normal bill-edit permission, plus edit_paid_bill once the bill is fully paid (owners/admins always pass).
router.patch(
  '/appointment/:id/method',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  requireAnyPermission(['edit_appointment', 'create_sales']),
  requirePaidBillEditPermission,
  paymentsController.changeMethod
);
router.get(
  '/:appointmentId',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  paymentsController.getByAppointmentId
);

export default router;
