import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { usersController } from './users.controller'
import { validateCreateUser, validateUpdateUser } from './users.validator'

const router = Router()

// GET /api/v1/users
router.get(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  usersController.getAll
)

// POST /api/v1/users
router.post(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  validateCreateUser,
  usersController.create
)

// PATCH /api/v1/users/:id
router.patch(
  '/:id',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  validateUpdateUser,
  usersController.update
)

// DELETE /api/v1/users/:id
router.delete(
  '/:id',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  usersController.remove
)

export default router
