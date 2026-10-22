import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { posPaymentsController } from './pos-payments.controller';

const router = Router();
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff');

// Same role gate as payments.routes.ts — taking a Payment Machine payment is
// a normal front-desk action, not a settings change (that's payment-settings.routes.ts).
router.post('/',                  authMiddleware, ownerAdminStaff, posPaymentsController.create);
router.get('/appointment/:appointmentId/active', authMiddleware, ownerAdminStaff, posPaymentsController.getActiveForAppointment);
router.get('/:id/status',         authMiddleware, ownerAdminStaff, posPaymentsController.getStatus);
router.post('/:id/cancel',        authMiddleware, ownerAdminStaff, posPaymentsController.cancel);
router.post('/:id/confirm-manual',authMiddleware, ownerAdminStaff, posPaymentsController.confirmManual);
router.get('/:id/events',         authMiddleware, ownerAdminStaff, posPaymentsController.listEvents);
// Clearing a review flag unblocks further payments for the appointment —
// owner/admin only, with a mandatory note recorded in the event trail.
router.post('/:id/reconcile',     authMiddleware, roleMiddleware('salon_owner', 'admin'), posPaymentsController.reconcileReview);

// Public — a payment provider cannot send a JWT. Signature-verified inside
// the handler per-provider before anything changes state.
router.post('/webhook/:provider', posPaymentsController.webhook);

export default router;
