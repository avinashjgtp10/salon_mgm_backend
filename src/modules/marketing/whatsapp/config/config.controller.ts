import { Request, Response, NextFunction } from 'express'
import { configService } from './config.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const configController = {

  async getConfig(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      // Frontend: api.get('/wa-config').then(r => r.data)
      const data = await configService.getConfig(salonId)
      return res.status(200).json(data)
    } catch (e) {
      return next(e)
    }
  },

  async saveConfig(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      // Frontend: api.put('/wa-config', payload).then(r => r.data)
      const data = await configService.saveConfig(salonId, req.body)
      return res.status(200).json(data)
    } catch (e) {
      return next(e)
    }
  },

  async testConnection(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      // Frontend: api.post('/wa-config/test').then(r => r.data)
      const data = await configService.testConnection(salonId)
      return res.status(200).json(data)
    } catch (e) {
      return next(e)
    }
  },
}
