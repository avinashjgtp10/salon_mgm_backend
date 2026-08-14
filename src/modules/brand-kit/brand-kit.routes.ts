import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { brandKitController } from './brand-kit.controller';

const router = Router();
const guard = [authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff')] as const;

router.get('/', ...guard, brandKitController.get);

export default router;
