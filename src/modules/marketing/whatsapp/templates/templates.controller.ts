import { Request, Response, NextFunction } from 'express'
import { sendSuccess } from '../../../utils/response.util'
import { AppError } from '../../../../middleware/error.middleware'
import { linkBuilderService } from '../../../link-builder/link-builder.service'
import { templatesService } from './templates.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const templatesController = {

  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await templatesService.getAll(salonId)
      return sendSuccess(res, 200, data, 'Templates fetched successfully')
    } catch (e) { return next(e) }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await templatesService.getById(req.params.id as string, salonId)
      return sendSuccess(res, 200, data, 'Template fetched successfully')
    } catch (e) { return next(e) }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await templatesService.create(salonId, req.body, req.file)
      return sendSuccess(res, 201, data, 'Template created successfully')
    } catch (e) { return next(e) }
  },

  // Save a text template here only (nothing goes to Meta yet) - used by "Create with LUNOX".
  async createDraft(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const b = req.body ?? {}
      let buttons = Array.isArray(b.buttons) ? b.buttons.map((x: any) => ({ type: x?.type, text: String(x?.text ?? ''), value: String(x?.value ?? '') })) : []
      // "Book again": a link button to the salon's own booking page, built here so the client never handles the URL.
      if (b.book_again === true && buttons.length === 0) {
        const link = await linkBuilderService.generate(salonId, { type: 'any' } as any)
        if (!/^https:\/\//.test(link.bookingUrl)) throw new AppError(400, 'Your online booking page needs a public https link before it can be used as a button.', 'VALIDATION_ERROR')
        buttons = [{ type: 'url', text: 'Book again', value: link.bookingUrl }]
      }
      const data = await templatesService.createDraft(salonId, {
        name: String(b.name ?? ''), category: b.category, language: String(b.language ?? ''), header_type: 'none',
        body_text: String(b.body_text ?? ''), footer_text: b.footer_text ? String(b.footer_text) : null,
        buttons,
      })
      return sendSuccess(res, 201, data, 'Draft saved')
    } catch (e) { return next(e) }
  },

  // Send a saved draft to Meta for approval.
  async submitDraft(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await templatesService.submitDraft(req.params.id as string, salonId)
      return sendSuccess(res, 200, data, 'Template sent to Meta for approval')
    } catch (e) { return next(e) }
  },

  async createCarousel(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const b = req.body ?? {}
      let cards: any[] = []
      try { cards = typeof b.cards === 'string' ? JSON.parse(b.cards) : (b.cards ?? []) } catch { cards = [] }
      // Card images arrive as card_0, card_1 ... in card order.
      const all = (req.files as Express.Multer.File[] | undefined) ?? []
      const files = cards.map((_c, i) => all.find(f => f.fieldname === `card_${i}`)).filter(Boolean) as Express.Multer.File[]
      const data = await templatesService.createCarousel(salonId, {
        name: String(b.name ?? ''), language: String(b.language ?? ''), body_text: String(b.body_text ?? ''), cards,
      }, files)
      return sendSuccess(res, 201, data, 'Carousel template created successfully')
    } catch (e) { return next(e) }
  },

  async fixMedia(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      if (!req.file)  return res.status(400).json({ error: 'No file uploaded' })
      const data = await templatesService.fixMedia(req.params.id as string, salonId, req.file)
      return sendSuccess(res, 200, data, 'Media ID updated successfully')
    } catch (e) { return next(e) }
  },

  async headerMedia(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const cardRaw = req.query.card
      const card = cardRaw !== undefined && /^\d+$/.test(String(cardRaw)) ? parseInt(String(cardRaw), 10) : undefined
      const { buffer, mimeType } = await templatesService.getHeaderMedia(req.params.id as string, salonId, card)
      res.setHeader('Content-Type', mimeType)
      res.setHeader('Cache-Control', 'private, max-age=3600')
      return res.send(buffer)
    } catch (e) { return next(e) }
  },

  async syncStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await templatesService.syncStatus(req.params.id as string, salonId)
      return sendSuccess(res, 200, data, 'Template synced successfully')
    } catch (e) { return next(e) }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await templatesService.delete(req.params.id as string, salonId)
      return sendSuccess(res, 200, data, 'Template deleted successfully')
    } catch (e) { return next(e) }
  },
  async toggleFavorite(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await templatesService.toggleFavorite(req.params.id as string, salonId)
      return sendSuccess(res, 200, data, 'Template favorite updated')
    } catch (e) { return next(e) }
  },
}