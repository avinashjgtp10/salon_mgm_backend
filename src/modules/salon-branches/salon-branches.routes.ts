import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { salonBranchesController } from './salon-branches.controller';

const router = Router();

// Owner-only, by role rather than a permission key: connecting an account means handling someone else's
// credentials. The service additionally refuses connected salons and impersonated sessions (no nesting).
const owner = [authMiddleware, roleMiddleware('salon_owner')];
// An existing Branch Owner can also connect salons to their own portal (list, verify, connect and disconnect only).
const ownerOrBranchOwner = [authMiddleware, roleMiddleware('salon_owner', 'branch_owner')];

router.get('/portal',              ...owner, salonBranchesController.portalStatus);
router.post('/portal/open',        ...owner, salonBranchesController.openPortal);
router.get('/',                    ...ownerOrBranchOwner, salonBranchesController.list);
router.post('/verify',             ...ownerOrBranchOwner, salonBranchesController.verify);
router.post('/',                   ...ownerOrBranchOwner, salonBranchesController.connect);
router.post('/login',              ...owner, salonBranchesController.createLogin);
router.patch('/login',             ...owner, salonBranchesController.updateLogin);
router.delete('/:id',              ...ownerOrBranchOwner, salonBranchesController.disconnect);

export default router;
