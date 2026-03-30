import { Request, Response, NextFunction } from 'express'

// Dashboard has no request body to validate
// Keeping file for consistency with module structure
export const validateDashboard = (
  _req: Request,
  _res: Response,
  next: NextFunction
) => next()
