import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { couponsController } from './coupons.controller';

const router = Router();

router.post('/validate', authMiddleware, couponsController.validate);
router.get('/', authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff'), couponsController.list);

export default router;
