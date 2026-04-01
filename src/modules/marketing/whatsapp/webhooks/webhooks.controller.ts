import { Request, Response, NextFunction } from 'express'
import { sendSuccess } from '../../../utils/response.util'
import { webhooksService } from './webhooks.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const webhooksController = {

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = req.params.salonId as string
      const mode        = req.query['hub.mode']         as string
      const token       = req.query['hub.verify_token'] as string
      const challenge   = req.query['hub.challenge']    as string
      const result      = await webhooksService.verify(salonId, mode, token, challenge)
      return res.status(200).send(result)
    } catch (e) { return next(e) }
  },

  async handle(req: Request, res: Response, next: NextFunction) {
    try {
      // Respond to Meta immediately
      res.status(200).json({ success: true })
      await webhooksService.handleWebhook(req.body)
    } catch (e) { return next(e) }
  },

  async getEvents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId    = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      const campaignId = req.query.campaignId as string | undefined
      const data       = await webhooksService.getRecentEvents(salonId, campaignId)

      // Frontend: api.get('/webhooks/events').then(r => r.data.data)
      return sendSuccess(res, 200, data, 'Webhook events fetched successfully')
    } catch (e) { return next(e) }
  },
}
