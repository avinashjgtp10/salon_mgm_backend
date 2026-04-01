import { Request, Response, NextFunction } from 'express'
import { sendSuccess } from '../../../utils/response.util'
import { campaignsService } from './campaigns.service'

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const campaignsController = {

  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await campaignsService.getAll(salonId)
      return sendSuccess(res, 200, data, 'Campaigns fetched successfully')
    } catch (e) { return next(e) }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await campaignsService.getById(req.params.id as string, salonId)
      return sendSuccess(res, 200, data, 'Campaign fetched successfully')
    } catch (e) { return next(e) }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await campaignsService.create(salonId, req.body)
      return sendSuccess(res, 201, data, 'Campaign created successfully')
    } catch (e) { return next(e) }
  },

  async pause(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await campaignsService.pause(req.params.id as string, salonId)
      return sendSuccess(res, 200, data, 'Campaign paused successfully')
    } catch (e) { return next(e) }
  },

  async resume(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await campaignsService.resume(req.params.id as string, salonId)
      return sendSuccess(res, 200, data, 'Campaign resumed successfully')
    } catch (e) { return next(e) }
  },

  async getContacts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const status  = req.query.status as string | undefined
      const data    = await campaignsService.getContacts(req.params.id as string, salonId, status)
      return sendSuccess(res, 200, data, 'Contacts fetched successfully')
    } catch (e) { return next(e) }
  },

  async getReport(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data    = await campaignsService.getReport(req.params.id as string, salonId, req.params.type as string)
      return sendSuccess(res, 200, data, 'Report fetched successfully')
    } catch (e) { return next(e) }
  },
}
