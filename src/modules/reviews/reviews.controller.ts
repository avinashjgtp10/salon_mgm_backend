import { Request, Response, NextFunction } from "express"
import { reviewsService } from "./reviews.service"

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const reviewsController = {

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: "salonId missing from token" })

      const staffId = req.query.staff_id as string | undefined
      const page  = parseInt(String(req.query.page  || "1"),  10) || 1
      const limit = parseInt(String(req.query.limit || "20"), 10) || 20

      const data = await reviewsService.getReviews(salonId, { staffId, page, limit })
      return res.status(200).json(data)
    } catch (e) {
      return next(e)
    }
  },

  async stats(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: "salonId missing from token" })

      const staffId = req.query.staff_id as string | undefined
      const data = await reviewsService.getStats(salonId, staffId)
      return res.status(200).json(data)
    } catch (e) {
      return next(e)
    }
  },
}
