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
}
