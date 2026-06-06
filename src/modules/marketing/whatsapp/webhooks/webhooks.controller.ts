import { Request, Response, NextFunction } from 'express'
import { sendSuccess } from '../../../utils/response.util'
import { webhooksService } from './webhooks.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const webhooksController = {

  // ── Global verify — Meta App Dashboard calls this ─────────────────────────
  // GET /api/v1/webhooks/whatsapp
  // Looks up salon by hub.verify_token → returns challenge
  async verifyGlobal(req: Request, res: Response, next: NextFunction) {
    try {
      const mode      = req.query['hub.mode']         as string
      const token     = req.query['hub.verify_token'] as string
      const challenge = req.query['hub.challenge']    as string
      const result    = await webhooksService.verifyGlobal(mode, token, challenge)
      return res.status(200).send(result)
    } catch (e) { return next(e) }
  },

  // ── Global handle — Meta App Dashboard POSTs all events here ──────────────
  // POST /api/v1/webhooks/whatsapp
  // Salon identified by phone_number_id in the payload
  async handleGlobal(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ success: true })
      await webhooksService.handleWebhook(req.body)
    } catch (e) { return next(e) }
  },

  // ── Per-salon verify — backward compat ───────────────────────────────────
  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId   = req.params.salonId as string
      const mode      = req.query['hub.mode']         as string
      const token     = req.query['hub.verify_token'] as string
      const challenge = req.query['hub.challenge']    as string
      const result    = await webhooksService.verify(salonId, mode, token, challenge)
      return res.status(200).send(result)
    } catch (e) { return next(e) }
  },

  // ── Per-salon handle — backward compat ───────────────────────────────────
  async handle(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ success: true })
      const body = { ...req.body, _salonId: req.params.salonId }
      await webhooksService.handleWebhook(body)
    } catch (e) { return next(e) }
  },

  async getEvents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const campaignId = req.query.campaignId as string | undefined
      const data       = await webhooksService.getRecentEvents(salonId, campaignId)
      return sendSuccess(res, 200, data, 'Webhook events fetched successfully')
    } catch (e) { return next(e) }
  },
}