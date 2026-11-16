import { Router } from 'express'
import { marketingLogsController } from './marketing-logs.controller'

// Mounted under /api/v1/super-admin/marketing-logs, behind authMiddleware + superAdminMiddleware (see super-admin.routes.ts).
const router = Router()

router.get('/summary', marketingLogsController.summary)
router.get('/', marketingLogsController.list)

export default router
