import { Request, Response, NextFunction } from 'express'
import { dashboardService } from './dashboard.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const dashboardController = {

  async getStats(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      // Frontend reads r.data directly (no sendSuccess wrapper)
      const data = await dashboardService.getStats(salonId)
      return res.status(200).json(data)
    } catch (e) {
      return next(e)
    }
  },

  async getTopTemplatesPaged(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const page  = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10))
      const data = await dashboardService.getTopTemplatesPaged(salonId, page, limit)
      return res.status(200).json(data)
    } catch (e) {
      return next(e)
    }
  },

  async getEngagedContactsPaged(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const page  = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10))
      const data = await dashboardService.getEngagedContactsPaged(salonId, page, limit)
      return res.status(200).json(data)
    } catch (e) {
      return next(e)
    }
  },
}
