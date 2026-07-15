import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { couponsController } from './coupons.controller';

const router = Router();

router.post('/validate', authMiddleware, couponsController.validate);
router.get('/', authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff'), couponsController.list);

// ---------------- MANAGEMENT (Settings → Coupons) ----------------
router.get('/mine', authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff'), couponsController.listOwn);
router.post('/', authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff'), couponsController.create);
router.post('/bulk', authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff'), couponsController.createBulk);
router.patch('/:id', authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff'), couponsController.update);
router.delete('/batch/:batchId', authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff'), couponsController.removeBatch);
router.delete('/:id', authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff'), couponsController.remove);

export default router;
