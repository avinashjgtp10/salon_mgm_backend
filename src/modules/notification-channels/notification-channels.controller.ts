// ============================================================
// SalonOx — Notification Channel Templates: Controller
// ============================================================

import { Request, Response, NextFunction } from "express"
import { notificationChannelsService } from "./notification-channels.service"
import { sendSuccess } from "../utils/response.util"
import { AppError } from "../../middleware/error.middleware"
import { getSalonId } from "../utils/salon.util"
import { Channel } from "./notification-channels.types"

// Same ownership guard as wa-purchase-templates.controller.ts — the
// :salonId path param is client-supplied, so without this any authenticated
// user could read/edit another salon's channel templates.
async function resolveOwnedSalonId(req: Request): Promise<string> {
  const paramSalonId = req.params.salonId as string
  const role = (req as any).user?.role
  if (role === "admin") return paramSalonId
  const ownSalonId = await getSalonId(req)
  if (paramSalonId !== ownSalonId) {
    throw new AppError(403, "You can only access your own salon's notification templates", "FORBIDDEN")
  }
  return ownSalonId
}

export const notificationChannelsController = {

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      const data = await notificationChannelsService.list(salonId)
      sendSuccess(res, 200, data, "Notification channel templates fetched")
    } catch (err) { next(err) }
  },

  async updateSms(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      if (typeof req.body?.body !== "string") return next(new AppError(400, "body is required", "VALIDATION_ERROR"))
      const data = await notificationChannelsService.updateSmsBody(salonId, String(req.params.eventType), req.body.body)
      sendSuccess(res, 200, data, "SMS wording saved")
    } catch (err) { next(err) }
  },

  async updateEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      if (typeof req.body?.subject !== "string" || typeof req.body?.body !== "string") {
        return next(new AppError(400, "subject and body are required", "VALIDATION_ERROR"))
      }
      const data = await notificationChannelsService.updateEmailContent(salonId, String(req.params.eventType), req.body.subject, req.body.body)
      sendSuccess(res, 200, data, "Email content saved")
    } catch (err) { next(err) }
  },

  async setEnabled(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      const channel = String(req.params.channel).toUpperCase()
      if (channel !== "SMS" && channel !== "EMAIL") return next(new AppError(400, `Invalid channel: ${channel}`, "VALIDATION_ERROR"))
      if (typeof req.body?.enabled !== "boolean") return next(new AppError(400, "enabled (boolean) is required", "VALIDATION_ERROR"))
      const data = await notificationChannelsService.setEnabled(salonId, String(req.params.eventType), channel as Channel, req.body.enabled)
      sendSuccess(res, 200, data, "Channel setting saved")
    } catch (err) { next(err) }
  },

  // POST /api/v1/notification-channels/:salonId/test/:channel  body: { to }
  // Fires one real send right now via whichever provider is currently
  // configured — see notificationChannelsService.sendTest's doc comment.
  async sendTest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await resolveOwnedSalonId(req)
      const channel = String(req.params.channel).toUpperCase()
      if (channel !== "SMS" && channel !== "EMAIL") return next(new AppError(400, `Invalid channel: ${channel}`, "VALIDATION_ERROR"))
      const to = String(req.body?.to || "").trim()
      if (!to) return next(new AppError(400, "to is required", "VALIDATION_ERROR"))
      const data = await notificationChannelsService.sendTest(channel as Channel, to)
      sendSuccess(res, 200, data, `Test ${channel === "SMS" ? "SMS" : "email"} sent`)
    } catch (err) { next(err) }
  },
}
