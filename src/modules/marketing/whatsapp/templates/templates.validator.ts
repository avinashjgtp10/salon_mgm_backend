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

const VALID_BUTTON_TYPES = ['quick_reply', 'url', 'phone', 'copy_code']

// Meta caps: copy-code example is max 15 chars; the limited-time-offer badge
// text is max 16 chars.
const COPY_CODE_LIMIT = 15
const LTO_TEXT_LIMIT  = 16

const BODY_LIMIT   = 1024
const FOOTER_LIMIT = 60
const HEADER_LIMIT = 60

// Meta's WhatsApp template header media caps
const MAX_HEADER_FILE_SIZE: Record<string, number> = {
  image:    5  * 1024 * 1024,
  video:    16 * 1024 * 1024,
  document: 10 * 1024 * 1024,
}

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

    const maxSize = MAX_HEADER_FILE_SIZE[b.header_type]
    if (maxSize && (req as any).file && (req as any).file.size > maxSize) {
      const maxMB = maxSize / (1024 * 1024)
      const fileMB = ((req as any).file.size / (1024 * 1024)).toFixed(1)
      throw new AppError(
        400,
        `File is too large — max ${maxMB}MB for a ${b.header_type} header (received ${fileMB}MB)`,
        'VALIDATION_ERROR'
      )
    }

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
      if (btn.type === 'copy_code' && !isNonEmpty(btn.value)) return false
      return true
    })

    if (b.buttons.length > 3)
      throw new AppError(400, 'maximum 3 buttons allowed', 'VALIDATION_ERROR')

    for (const btn of b.buttons) {
      if (!VALID_BUTTON_TYPES.includes(btn.type))
        throw new AppError(400, 'button type must be quick_reply, url, phone or copy_code', 'VALIDATION_ERROR')
      if (btn.type === 'copy_code' && (btn.value.length > COPY_CODE_LIMIT || /\s/.test(btn.value)))
        throw new AppError(400, `copy-code example must be ${COPY_CODE_LIMIT} characters or fewer with no spaces`, 'VALIDATION_ERROR')
      if (!isNonEmpty(btn.text))
        throw new AppError(400, 'button text is required', 'VALIDATION_ERROR')
      if (btn.text.length > 25)
        throw new AppError(400, 'button text must be under 25 characters', 'VALIDATION_ERROR')
      if (btn.type === 'url' && !isNonEmpty(btn.value))
        throw new AppError(400, 'button value (url) is required for url type', 'VALIDATION_ERROR')
      if (btn.type === 'phone' && !isNonEmpty(btn.value))
        throw new AppError(400, 'button value (phone) is required for phone type', 'VALIDATION_ERROR')
    }

    if (b.buttons.filter((btn: any) => btn.type === 'copy_code').length > 1)
      throw new AppError(400, 'only one copy-code button is allowed', 'VALIDATION_ERROR')

    // ── Limited-time offer ────────────────────────────────────────────────────
    // Meta only allows the countdown badge on MARKETING templates whose header
    // is an image or video.
    if (b.lto_text !== undefined && b.lto_text !== null && String(b.lto_text).trim() === '') b.lto_text = null
    if (b.lto_text) {
      if (String(b.lto_text).length > LTO_TEXT_LIMIT)
        throw new AppError(400, `offer badge text must be ${LTO_TEXT_LIMIT} characters or fewer`, 'VALIDATION_ERROR')
      if (b.category !== 'MARKETING')
        throw new AppError(400, 'limited-time offers are only allowed on MARKETING templates', 'VALIDATION_ERROR')
      if (b.header_type !== 'image' && b.header_type !== 'video')
        throw new AppError(400, 'limited-time offers need an image or video header', 'VALIDATION_ERROR')
    }

    return next()
  } catch (e) {
    return next(e)
  }
}