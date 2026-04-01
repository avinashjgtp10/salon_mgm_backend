import { Request, Response, NextFunction } from 'express'
import { sendSuccess } from '../../../utils/response.util'
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
      const data = await templatesService.create(salonId, req.body)
      return sendSuccess(res, 201, data, 'Template created successfully')
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
}
