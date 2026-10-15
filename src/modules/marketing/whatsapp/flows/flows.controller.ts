import { Request, Response, NextFunction } from 'express'
import { sendSuccess } from '../../../utils/response.util'
import { flowsService } from './flows.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const flowsController = {

  async getBooking(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const state  = await flowsService.getBookingFlow(salonId)
      const invite = state.migrated ? await flowsService.getInviteTemplate(salonId).catch(() => null) : null
      const form   = await flowsService.getBookingConfig(salonId)
      return sendSuccess(res, 200, {
        ...state, invite,
        config: form.config, config_updated_at: form.updated_at, config_migrated: form.migrated,
      }, 'OK')
    } catch (e) { return next(e) }
  },

  async listServices(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      return sendSuccess(res, 200, await flowsService.listServicesForPicker(salonId), 'OK')
    } catch (e) { return next(e) }
  },

  async saveConfig(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      return sendSuccess(res, 200, await flowsService.saveBookingConfig(salonId, req.body), 'Booking form changes saved')
    } catch (e) { return next(e) }
  },

  async publishBooking(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      return sendSuccess(res, 201, await flowsService.publishBookingFlow(salonId), 'Booking form published')
    } catch (e) { return next(e) }
  },

  async createInvite(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      return sendSuccess(res, 201, await flowsService.createInviteTemplate(salonId), 'Invitation template submitted to Meta')
    } catch (e) { return next(e) }
  },

  async setAutoSend(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const enabled = req.body?.enabled === true
      return sendSuccess(res, 200, await flowsService.setAutoSend(salonId, enabled), 'OK')
    } catch (e) { return next(e) }
  },

  async sendBooking(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const phone = decodeURIComponent(req.params.phone as string)
      return sendSuccess(res, 201, await flowsService.sendBookingFlow(salonId, phone), 'Booking form sent')
    } catch (e) { return next(e) }
  },
}
