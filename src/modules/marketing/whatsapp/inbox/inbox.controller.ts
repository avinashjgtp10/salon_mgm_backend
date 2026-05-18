import { Request, Response, NextFunction } from 'express'
import { sendSuccess } from '../../../utils/response.util'
import { inboxService } from './inbox.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const inboxController = {

  async getConversations(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      const data = await inboxService.getConversations(salonId)
      return sendSuccess(res, 200, data, 'Conversations fetched successfully')
    } catch (e) { return next(e) }
  },

  async getMessages(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      const phone = decodeURIComponent(req.params.phone as string)
      const data  = await inboxService.getMessages(salonId, phone)
      return sendSuccess(res, 200, data, 'Messages fetched successfully')
    } catch (e) { return next(e) }
  },

  async sendReply(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      const phone   = decodeURIComponent(req.params.phone as string)
      const message = req.body.message as string
      const data    = await inboxService.sendReply(salonId, phone, message)
      return sendSuccess(res, 201, data, 'Reply sent successfully')
    } catch (e) { return next(e) }
  },
}