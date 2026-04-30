import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { paymentsController } from './payments.controller';
import { validateCreatePayment } from './payments.validator';

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
router.get(
  '/:appointmentId',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  paymentsController.getByAppointmentId
);

export default router;
