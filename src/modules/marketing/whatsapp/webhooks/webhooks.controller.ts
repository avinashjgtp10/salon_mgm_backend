import { Request, Response, NextFunction } from 'express'
import { webhooksService } from './webhooks.service'
import logger from '../../../../config/logger'

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
  handleGlobal(req: Request, res: Response) {
    res.status(200).json({ success: true })
    // Logged unconditionally, before any parsing/processing — this is the one
    // line that proves Meta is calling us at all. Everything downstream only
    // logs on specific branches (FAILED status, capability updates), so a
    // silent delivery mystery with zero webhook log lines is otherwise
    // indistinguishable from "Meta never called us".
    logger.info('📩 [WEBHOOK] Incoming payload', { body: req.body })
    void webhooksService.handleWebhook(req.body).catch(err =>
      logger.error('handleGlobal: webhook processing failed', { err })
    )
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
  handle(req: Request, res: Response) {
    res.status(200).json({ success: true })
    logger.info('📩 [WEBHOOK] Incoming payload (per-salon)', { salonId: req.params.salonId, body: req.body })
    const body = { ...req.body, _salonId: req.params.salonId }
    void webhooksService.handleWebhook(body).catch(err =>
      logger.error('handle: webhook processing failed', { err })
    )
  },
}