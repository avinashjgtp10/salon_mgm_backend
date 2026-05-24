import { Request, Response, NextFunction } from 'express'
import { analyticsService } from './analytics.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const analyticsController = {

  async getAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      const { start, end, granularity } = req.query as {
        start:        string
        end:          string
        granularity?: 'DAILY' | 'MONTHLY'
      }

      if (!start || !end) {
        return res.status(400).json({ error: 'start and end query params are required (YYYY-MM-DD)' })
      }

      const dateRx = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRx.test(start) || !dateRx.test(end)) {
        return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' })
      }

      const data = await analyticsService.getAnalytics(salonId, { start, end, granularity })
      return res.status(200).json(data)
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ error: e.message })
      return next(e)
    }
  },
}