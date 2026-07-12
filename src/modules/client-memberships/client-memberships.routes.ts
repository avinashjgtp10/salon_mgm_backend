import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireSalon } from '../../middleware/salon.middleware';
import { clientMembershipsController } from './client-memberships.controller';

const router = Router();
const auth   = [authMiddleware, requireSalon];

router.get('/',              ...auth, clientMembershipsController.list);
router.post('/',             ...auth, clientMembershipsController.purchase);
router.post('/sync',         ...auth, clientMembershipsController.sync);
router.get('/debug',         ...auth, clientMembershipsController.debug);
router.get('/:id',           ...auth, clientMembershipsController.getById);
router.patch('/:id/consume', ...auth, clientMembershipsController.consume);
router.patch('/:id/cancel',  ...auth, clientMembershipsController.cancel);

export default router;
