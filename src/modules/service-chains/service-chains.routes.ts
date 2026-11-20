import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { requireModule } from '../../middleware/moduleLock.middleware'
import { requireSalon } from '../../middleware/salon.middleware'
import { roleMiddleware } from '../../middleware/role.middleware'
import { requirePermission } from '../../middleware/permission.middleware'
import { sendSuccess } from '../utils/response.util'
import { serviceChainsService } from './service-chains.service'

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } }

const router = Router()

// Marketing sub-feature: same module lock as campaigns, its own two permission keys.
router.use(authMiddleware, requireSalon, roleMiddleware('salon_owner', 'admin', 'staff'), requireModule('marketing'))

const view = requirePermission('view_service_chains')
const manage = requirePermission('manage_service_chains')

const wrap = (fn: (req: AuthRequest, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req as AuthRequest, res).catch(next) }

const salon = (req: AuthRequest) => req.user!.salonId!

router.get('/', view, wrap(async (req, res) => {
  sendSuccess(res, 200, await serviceChainsService.list(salon(req)), 'Service chains fetched')
}))

router.post('/messages/:messageId/retry', manage, wrap(async (req, res) => {
  await serviceChainsService.retryMessage(req.params.messageId as string, salon(req))
  sendSuccess(res, 200, null, 'Message queued to retry')
}))

router.get('/messages/:messageId/history', view, wrap(async (req, res) => {
  sendSuccess(res, 200, await serviceChainsService.messageHistory(req.params.messageId as string, salon(req)), 'History fetched')
}))

router.get('/:id', view, wrap(async (req, res) => {
  sendSuccess(res, 200, await serviceChainsService.getById(req.params.id as string, salon(req)), 'Service chain fetched')
}))

router.post('/', manage, wrap(async (req, res) => {
  sendSuccess(res, 201, await serviceChainsService.create(salon(req), req.body), 'Service chain created')
}))

router.patch('/:id', manage, wrap(async (req, res) => {
  sendSuccess(res, 200, await serviceChainsService.update(req.params.id as string, salon(req), req.body), 'Service chain updated')
}))

router.patch('/:id/active', manage, wrap(async (req, res) => {
  sendSuccess(res, 200, await serviceChainsService.setActive(req.params.id as string, salon(req), req.body?.is_active === true), 'Service chain updated')
}))

router.delete('/:id', manage, wrap(async (req, res) => {
  await serviceChainsService.remove(req.params.id as string, salon(req))
  sendSuccess(res, 200, null, 'Service chain deleted')
}))

router.get('/:id/enrolments', view, wrap(async (req, res) => {
  const q = req.query
  sendSuccess(res, 200, await serviceChainsService.listEnrolments(req.params.id as string, salon(req), {
    status: q.status as string | undefined,
    page: q.page ? Number(q.page) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  }), 'Enrolments fetched')
}))

router.post('/enrolments/:enrolmentId/cancel', manage, wrap(async (req, res) => {
  await serviceChainsService.cancelEnrolment(req.params.enrolmentId as string, salon(req))
  sendSuccess(res, 200, null, 'Journey cancelled')
}))

router.post('/enrolments/:enrolmentId/pause', manage, wrap(async (req, res) => {
  await serviceChainsService.pauseEnrolment(req.params.enrolmentId as string, salon(req))
  sendSuccess(res, 200, null, 'Journey paused')
}))

router.post('/enrolments/:enrolmentId/resume', manage, wrap(async (req, res) => {
  await serviceChainsService.resumeEnrolment(req.params.enrolmentId as string, salon(req))
  sendSuccess(res, 200, null, 'Journey resumed')
}))

export default router
