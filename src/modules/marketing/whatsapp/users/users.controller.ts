import { Request, Response, NextFunction } from 'express'
import { usersService } from './users.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const usersController = {

  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      
      const data = await usersService.getAll(salonId)
      return res.status(200).json(data)
    } catch (e) { return next(e) }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      // Frontend: api.post('/users', payload).then(r => r.data)
      const data = await usersService.create(salonId, req.body)
      return res.status(201).json(data)
    } catch (e) { return next(e) }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      // Frontend: api.patch('/users/:id', payload).then(r => r.data)
      const data = await usersService.update(req.params.id as string, salonId, req.body)
      return res.status(200).json(data)
    } catch (e) { return next(e) }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })

      // Frontend: api.delete('/users/:id').then(r => r.data)
      const data = await usersService.remove(req.params.id as string, salonId)
      return res.status(200).json(data)
    } catch (e) { return next(e) }
  },
}
