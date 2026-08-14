import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { couponDesignsController } from './coupon-designs.controller';

const router = Router();

const canDesign = [authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff')] as const;

router.get('/', ...canDesign, couponDesignsController.list);
router.post('/', ...canDesign, couponDesignsController.create);
// Registered before '/:id' so "duplicate" can never be parsed as an id.
router.post('/:id/duplicate', ...canDesign, couponDesignsController.duplicate);
router.post('/:id/export', ...canDesign, couponDesignsController.exportDesign);
router.get('/:id', ...canDesign, couponDesignsController.get);
router.patch('/:id', ...canDesign, couponDesignsController.update);
router.delete('/:id', ...canDesign, couponDesignsController.remove);

export default router;
