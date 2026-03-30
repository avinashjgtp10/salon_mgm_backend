import { Request, Response, NextFunction } from 'express'
import { AppError } from '../../../../middleware/error.middleware'

const isNonEmpty = (v: unknown): boolean =>
  typeof v === 'string' && v.trim().length > 0

const VALID_ROLES = ['salon_owner', 'staff', 'admin']

export const validateCreateUser = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body
    if (!isNonEmpty(b.first_name)) throw new AppError(400, 'first_name is required', 'VALIDATION_ERROR')
    if (!isNonEmpty(b.last_name))  throw new AppError(400, 'last_name is required',  'VALIDATION_ERROR')
    if (!isNonEmpty(b.email))      throw new AppError(400, 'email is required',       'VALIDATION_ERROR')
    if (!isNonEmpty(b.password) || b.password.length < 6)
      throw new AppError(400, 'password must be at least 6 characters', 'VALIDATION_ERROR')
    if (!VALID_ROLES.includes(b.role))
      throw new AppError(400, `role must be one of: ${VALID_ROLES.join(', ')}`, 'VALIDATION_ERROR')
    return next()
  } catch (e) { return next(e) }
}

export const validateUpdateUser = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body
    if (b.first_name !== undefined && !isNonEmpty(b.first_name))
      throw new AppError(400, 'first_name cannot be empty', 'VALIDATION_ERROR')
    if (b.last_name  !== undefined && !isNonEmpty(b.last_name))
      throw new AppError(400, 'last_name cannot be empty',  'VALIDATION_ERROR')
    if (b.email      !== undefined && !isNonEmpty(b.email))
      throw new AppError(400, 'email cannot be empty',      'VALIDATION_ERROR')
    if (b.password   !== undefined && b.password.length < 6)
      throw new AppError(400, 'password must be at least 6 characters', 'VALIDATION_ERROR')
    if (b.role !== undefined && !VALID_ROLES.includes(b.role))
      throw new AppError(400, `role must be one of: ${VALID_ROLES.join(', ')}`, 'VALIDATION_ERROR')
    return next()
  } catch (e) { return next(e) }
}
