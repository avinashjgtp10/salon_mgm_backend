import { Request, Response, NextFunction } from 'express'
import { AppError } from '../../../../middleware/error.middleware'

const isNonEmpty = (v: unknown): boolean =>
  typeof v === 'string' && v.trim().length > 0

const VALID_CATEGORIES   = ['MARKETING', 'UTILITY', 'AUTHENTICATION']
const VALID_HEADER_TYPES = ['none', 'text', 'image', 'video', 'document']

// ← Updated: added new languages to match frontend
const VALID_LANGUAGES = [
  'en_US', 'en_GB',
  'hi_IN', 'mr_IN', 'ta_IN', 'te_IN',
  'gu_IN', 'kn_IN', 'ml_IN', 'pa_IN',
  'en',
]

const VALID_BUTTON_TYPES = ['quick_reply', 'url', 'phone']

const BODY_LIMIT   = 1024
const FOOTER_LIMIT = 60
const HEADER_LIMIT = 60

export const validateCreateTemplate = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body

    // buttons may arrive as a JSON string when sent via FormData — parse first
    if (typeof b.buttons === 'string') {
      try { b.buttons = JSON.parse(b.buttons) }
      catch { b.buttons = [] }
    }
    if (b.buttons === undefined || b.buttons === null) b.buttons = []

    // ── Name ──────────────────────────────────────────────────────────────────
    if (!isNonEmpty(b.name))
      throw new AppError(400, 'name is required', 'VALIDATION_ERROR')
    if (!/^[a-z0-9_]+$/.test(b.name))
      throw new AppError(400, 'name must be lowercase letters, numbers and underscores only', 'VALIDATION_ERROR')
    if (b.name.length > 512)
      throw new AppError(400, 'name must be under 512 characters', 'VALIDATION_ERROR')

    // ── Category ──────────────────────────────────────────────────────────────
    // Note: allow_category_change removed April 9 2025 — Meta auto-reclassifies now
    if (!VALID_CATEGORIES.includes(b.category))
      throw new AppError(400, `category must be one of: ${VALID_CATEGORIES.join(', ')}`, 'VALIDATION_ERROR')

    // ── Language ──────────────────────────────────────────────────────────────
    if (!VALID_LANGUAGES.includes(b.language))
      throw new AppError(400, `language must be one of: ${VALID_LANGUAGES.join(', ')}`, 'VALIDATION_ERROR')

    // ── Header ────────────────────────────────────────────────────────────────
    if (!VALID_HEADER_TYPES.includes(b.header_type))
      throw new AppError(400, `header_type must be one of: ${VALID_HEADER_TYPES.join(', ')}`, 'VALIDATION_ERROR')
    if (b.header_type === 'text' && !isNonEmpty(b.header_text))
      throw new AppError(400, 'header_text is required when header_type is text', 'VALIDATION_ERROR')
    if (b.header_type === 'text' && b.header_text?.length > HEADER_LIMIT)
      throw new AppError(400, `header_text must be under ${HEADER_LIMIT} characters`, 'VALIDATION_ERROR')

    // ── Body ──────────────────────────────────────────────────────────────────
    if (!isNonEmpty(b.body_text) || b.body_text.trim().length < 10)
      throw new AppError(400, 'body_text must be at least 10 characters', 'VALIDATION_ERROR')
    if (b.body_text.length > BODY_LIMIT)
      throw new AppError(400, `body_text must be under ${BODY_LIMIT} characters`, 'VALIDATION_ERROR')

    // ── Footer ────────────────────────────────────────────────────────────────
    if (b.footer_text && b.footer_text.length > FOOTER_LIMIT)
      throw new AppError(400, `footer_text must be under ${FOOTER_LIMIT} characters`, 'VALIDATION_ERROR')

    // ── Buttons ───────────────────────────────────────────────────────────────
    if (!Array.isArray(b.buttons))
      throw new AppError(400, 'buttons must be an array', 'VALIDATION_ERROR')

    // filter out incomplete buttons rather than hard-rejecting the request
    b.buttons = b.buttons.filter((btn: any) => {
      if (!isNonEmpty(btn.text)) return false
      if (btn.type === 'url'   && !isNonEmpty(btn.value)) return false
      if (btn.type === 'phone' && !isNonEmpty(btn.value)) return false
      return true
    })

    if (b.buttons.length > 3)
      throw new AppError(400, 'maximum 3 buttons allowed', 'VALIDATION_ERROR')

    for (const btn of b.buttons) {
      if (!VALID_BUTTON_TYPES.includes(btn.type))
        throw new AppError(400, 'button type must be quick_reply, url or phone', 'VALIDATION_ERROR')
      if (!isNonEmpty(btn.text))
        throw new AppError(400, 'button text is required', 'VALIDATION_ERROR')
      if (btn.text.length > 25)
        throw new AppError(400, 'button text must be under 25 characters', 'VALIDATION_ERROR')
      if (btn.type === 'url' && !isNonEmpty(btn.value))
        throw new AppError(400, 'button value (url) is required for url type', 'VALIDATION_ERROR')
      if (btn.type === 'phone' && !isNonEmpty(btn.value))
        throw new AppError(400, 'button value (phone) is required for phone type', 'VALIDATION_ERROR')
    }

    return next()
  } catch (e) {
    return next(e)
  }
}