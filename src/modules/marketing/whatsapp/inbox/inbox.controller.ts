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

  async getUnreadCount(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      const unread = await inboxService.getUnreadTotal(salonId)
      return sendSuccess(res, 200, { unread }, 'Unread count fetched successfully')
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

  async getCustomerInfo(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      const phone = decodeURIComponent(req.params.phone as string)
      const data  = await inboxService.getCustomerInfo(salonId, phone)
      return sendSuccess(res, 200, data, 'Customer info fetched successfully')
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

  async typing(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const phone = decodeURIComponent(req.params.phone as string)
      const data  = await inboxService.markReadOnWhatsApp(salonId, phone, true)
      return sendSuccess(res, 200, data, 'OK')
    } catch (e) { return next(e) }
  },

  async sendMedia(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const file = (req as any).file as Express.Multer.File | undefined
      if (!file) return res.status(400).json({ error: 'No file uploaded' })
      const phone = decodeURIComponent(req.params.phone as string)
      const data  = await inboxService.sendMedia(salonId, phone, file, (req.body?.caption as string | undefined))
      return sendSuccess(res, 201, data, 'File sent successfully')
    } catch (e) { return next(e) }
  },

  async react(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji : ''
      if (emoji.length > 16) return res.status(400).json({ error: 'Invalid emoji' })
      const data = await inboxService.reactToMessage(salonId, req.params.id as string, emoji)
      return sendSuccess(res, 200, data, 'Reaction sent')
    } catch (e) { return next(e) }
  },

  async deleteConversations(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await inboxService.deleteConversations(salonId, req.body?.phones)
      return sendSuccess(res, 200, data, data.deleted === 1 ? 'Conversation deleted' : `${data.deleted} conversations deleted`)
    } catch (e) { return next(e) }
  },

  async getMedia(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const { buffer, mimeType } = await inboxService.getMedia(salonId, req.params.mediaId as string)
      res.setHeader('Content-Type', mimeType)
      res.setHeader('Cache-Control', 'private, max-age=3600')
      return res.send(buffer)
    } catch (e) { return next(e) }
  },

  async sendTemplate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      const phone = decodeURIComponent(req.params.phone as string)
      const { templateId, variables, couponCode, expiresAt } = req.body as {
        templateId: string; variables: Record<string, string>; couponCode?: string; expiresAt?: string
      }
      const data = await inboxService.sendTemplate(salonId, phone, templateId, variables ?? {}, { couponCode, expiresAt })
      return sendSuccess(res, 201, data, 'Template sent successfully')
    } catch (e) { return next(e) }
  },
}