import { Request, Response, NextFunction } from 'express'
import { AppError } from '../../../../middleware/error.middleware'

const isNonEmpty = (v: unknown): boolean =>
  typeof v === 'string' && v.trim().length > 0

export const validateSaveConfig = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body

    if (!isNonEmpty(b.phone_number_id))
      throw new AppError(400, 'phone_number_id is required', 'VALIDATION_ERROR')
    if (!isNonEmpty(b.waba_id))
      throw new AppError(400, 'waba_id is required', 'VALIDATION_ERROR')
    if (!isNonEmpty(b.webhook_verify_token))
      throw new AppError(400, 'webhook_verify_token is required', 'VALIDATION_ERROR')

    // FIX: access_token is optional on update (empty = keep existing)
    // Only required on first save (when no config exists yet)
    // app_id is optional but recommended for media header templates

    return next()
  } catch (e) {
    return next(e)
  }
}