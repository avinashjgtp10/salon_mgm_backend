import { Router, Request, Response, NextFunction } from 'express'
import pool from '../../../../config/database'
import { AppError } from '../../../../middleware/error.middleware'
import { configController } from './config.controller'
import { validateSaveConfig } from './config.validator'
import { configOtpService } from './config-otp.service'

// Super Admin > Salons > <salon> > WhatsApp connection.
//
// Mounted under /api/v1/super-admin/salons/:salonId/wa-config by
// super-admin.routes.ts, which has ALREADY run authMiddleware +
// superAdminMiddleware — so nothing here is reachable by a salon user. The same
// controller handlers the salon's own Configuration page used are reused
// unchanged; scopeToSalon just points them at the salon chosen in the URL
// instead of the salon in the caller's token.
const router = Router({ mergeParams: true })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const scopeToSalon = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const salonId = String(req.params.salonId ?? '')
    if (!UUID_RE.test(salonId)) throw new AppError(400, 'Invalid salon id', 'VALIDATION_ERROR')
    const { rows } = await pool.query(`SELECT 1 FROM salons WHERE id = $1`, [salonId])
    if (!rows[0]) throw new AppError(404, 'Salon not found', 'NOT_FOUND')
    ;(req as any).user = { ...(req as any).user, salonId }
    return next()
  } catch (e) {
    return next(e)
  }
}

router.use(scopeToSalon)

// Email OTP (sent to the approver mailbox) - required before PUT / DELETE below.
router.get('/otp/status', async (req, res, next) => {
  try { res.json({ success: true, data: await configOtpService.status((req as any).user.userId, String((req.params as any).salonId)) }) } catch (e) { next(e) }
})
router.post('/otp/request', async (req, res, next) => {
  try { res.json({ success: true, data: await configOtpService.request((req as any).user.userId, String((req.params as any).salonId)) }) } catch (e) { next(e) }
})
router.post('/otp/verify', async (req, res, next) => {
  try { res.json({ success: true, data: await configOtpService.verify((req as any).user.userId, String((req.params as any).salonId), req.body?.code) }) } catch (e) { next(e) }
})

router.get('/',               configController.getConfig)
router.put('/',               configOtpService.requireVerified, validateSaveConfig, configController.saveConfig)
router.delete('/',            configOtpService.requireVerified, configController.deleteConfig)
router.patch('/ai-receptionist', configController.setAiReceptionistEnabled)
router.post('/test',          configController.testConnection)
router.post('/sync-limits',   configController.syncLimits)
router.post('/verify-phone',  configController.verifyPhone)
router.post('/verify-app',    configController.verifyApp)
router.post('/verify-all',    configController.verifyAll)

export default router
