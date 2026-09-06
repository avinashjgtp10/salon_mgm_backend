import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { paymentSettingsController } from './payment-settings.controller';

const router = Router();
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff');
const managePos = requirePermission('manage_pos_payments');

// Everything here — including reads — is gated behind manage_pos_payments,
// unlike settings.routes.ts's open reads: terminal/provider config rows are
// financial setup, not shared display config other features read from.
router.get('/terminals',        authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.listTerminals);
router.post('/terminals',       authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.createTerminal);
router.put('/terminals/:id',    authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.updateTerminal);
router.delete('/terminals/:id', authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.deleteTerminal);

router.get('/providers',                    authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.listProviderConfigs);
router.post('/providers',                   authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.upsertProviderConfig);
router.post('/providers/:provider/test',    authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.testConnection);

export default router;
