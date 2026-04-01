import { Request, Response, NextFunction } from 'express'

// Webhook bodies come from Meta — no validation needed on incoming
// Keeping file for consistency with module structure
export const validateWebhookQuery = (
  _req: Request,
  _res: Response,
  next: NextFunction
) => next()
