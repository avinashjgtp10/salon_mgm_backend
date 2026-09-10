import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { requirePermission, requireAnyPermission } from '../../middleware/permission.middleware';
import { paymentSettingsController } from './payment-settings.controller';

const router = Router();
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff');
const managePos = requirePermission('manage_pos_payments');
// Quick Sale and Calendar checkout both need to know whether a card machine
// is available at all (usePosSettings.ts calls these two GETs on every
// checkout screen to decide whether "Payment Machine" appears as a payment
// option) — that's a materially different, much lower-risk question than
// "can this staff member add/edit/delete terminals or provider credentials",
// so reads alone also accept create_sales/manage_calendar, same OR-pattern
// already used for Products/Clients/Staff being read from Quick Sale.
const viewPos = requireAnyPermission(['manage_pos_payments', 'create_sales', 'manage_calendar']);

// Writes stay strictly manage_pos_payments — this is financial setup
// (terminal/provider config, credentials), not shared display config.
router.get('/terminals',        authMiddleware, ownerAdminStaff, viewPos,   paymentSettingsController.listTerminals);
router.post('/terminals',       authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.createTerminal);
router.put('/terminals/:id',    authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.updateTerminal);
router.delete('/terminals/:id', authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.deleteTerminal);

router.get('/providers',                    authMiddleware, ownerAdminStaff, viewPos,   paymentSettingsController.listProviderConfigs);
router.post('/providers',                   authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.upsertProviderConfig);
router.post('/providers/:provider/test',    authMiddleware, ownerAdminStaff, managePos, paymentSettingsController.testConnection);

export default router;
