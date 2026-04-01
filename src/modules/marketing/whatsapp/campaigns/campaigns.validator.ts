import { Request, Response, NextFunction } from 'express'
import { AppError } from '../../../../middleware/error.middleware'

const isNonEmpty = (v: unknown): boolean =>
  typeof v === 'string' && v.trim().length > 0

const isUUID = (v: unknown): boolean =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)

export const validateCreateCampaign = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body

    if (!isNonEmpty(b.name))
      throw new AppError(400, 'name is required', 'VALIDATION_ERROR')
    if (!isUUID(b.template_id))
      throw new AppError(400, 'template_id must be a valid UUID', 'VALIDATION_ERROR')
    if (!Array.isArray(b.contacts) || b.contacts.length === 0)
      throw new AppError(400, 'contacts must be a non-empty array', 'VALIDATION_ERROR')

    for (let i = 0; i < b.contacts.length; i++) {
      if (!isNonEmpty(b.contacts[i].phone))
        throw new AppError(400, `contacts[${i}].phone is required`, 'VALIDATION_ERROR')
    }

    if (b.batch_size !== undefined) {
      const bs = Number(b.batch_size)
      if (!Number.isInteger(bs) || bs < 1 || bs > 500)
        throw new AppError(400, 'batch_size must be between 1 and 500', 'VALIDATION_ERROR')
    }

    return next()
  } catch (e) {
    return next(e)
  }
}
