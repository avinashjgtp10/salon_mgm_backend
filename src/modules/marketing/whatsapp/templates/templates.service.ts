import axios from 'axios'
import FormData from 'form-data'
import { AppError } from '../../../../middleware/error.middleware'
import { templatesRepository } from './templates.repository'
import { configRepository } from '../config/config.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { CreateTemplateBody } from './templates.types'

const WA_BASE_URL    = process.env.WA_BASE_URL    ?? 'https://graph.facebook.com'
const WA_API_VERSION = process.env.WA_API_VERSION ?? 'v22.0'

// Meta's WhatsApp template header media caps
const MAX_HEADER_FILE_SIZE: Record<string, number> = {
  image:    5  * 1024 * 1024,
  video:    16 * 1024 * 1024,
  document: 10 * 1024 * 1024,
}

function extractExamples(text: string): string[] {
  const matches = text.match(/{{\d+}}/g) ?? []
  // Dedupe to unique variable numbers — Meta wants ONE example per distinct
  // variable; a repeated {{1}} must not produce two example entries (count
  // mismatch Meta rejects, or surfaces later as send error 132012).
  const unique = [...new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''), 10)))]
  return unique
    .sort((a, b) => a - b)
    .map(n => `Example${n}`)
}

async function uploadMediaHandle(
  file: Express.Multer.File,
  appId: string,
  accessToken: string
): Promise<string> {
  const sessionRes = await axios.post(
    `${WA_BASE_URL}/${WA_API_VERSION}/${appId}/uploads`,
    null,
    {
      params: {
        file_length:  file.size,
        file_type:    file.mimetype,
        file_name:    file.originalname,
        access_token: accessToken,
      },
    }
  )
  const uploadSessionId = sessionRes.data.id
  if (!uploadSessionId) throw new Error('No upload session ID returned from Meta')

  const uploadRes = await axios.post(
    `${WA_BASE_URL}/${WA_API_VERSION}/${uploadSessionId}`,
    file.buffer,
    {
      headers: {
        Authorization:  `OAuth ${accessToken}`,
        'file_offset':  '0',
        'Content-Type': file.mimetype,
      },
    }
  )
  if (!uploadRes.data.h) throw new Error('No upload handle returned from Meta')
  return uploadRes.data.h
}

async function uploadMediaId(
  file: Express.Multer.File,
  phoneNumberId: string,
  accessToken: string
): Promise<string> {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', file.mimetype)
  form.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype })

  const res = await axios.post(
    `${WA_BASE_URL}/${WA_API_VERSION}/${phoneNumberId}/media`,
    form,
    { headers: { Authorization: `Bearer ${accessToken}`, ...form.getHeaders() } }
  )
  if (!res.data.id) throw new Error('No media ID returned from Meta')
  return res.data.id
}

export const templatesService = {

  async getAll(salonId: string) {
    return templatesRepository.findAll(salonId)
  },

  async getById(id: string, salonId: string) {
    const t = await templatesRepository.findById(id, salonId)
    if (!t) throw new AppError(404, 'Template not found', 'NOT_FOUND')
    return t
  },

  // The template's actual header image/video/document, pulled from Meta (we
  // never keep our own copy of the upload). Tries the live media id first, then
  // falls back to the sample Meta stored with the template.
  async getHeaderMedia(id: string, salonId: string, card?: number): Promise<{ buffer: Buffer; mimeType: string }> {
    const template = await templatesRepository.findById(id, salonId)
    if (!template) throw new AppError(404, 'Template not found', 'NOT_FOUND')
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(404, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')

    // A carousel card's image (by position) - the card media id is all we keep.
    if (card !== undefined) {
      const cards: any[] = (template as any).carousel ?? []
      const mediaId = cards[card]?.header_media_id
      if (!mediaId) throw new AppError(404, 'Card image not found', 'MEDIA_NOT_FOUND')
      try { return await whatsappMetaApi.downloadMedia(config.access_token, mediaId) }
      catch { throw new AppError(404, 'Header media is no longer available', 'MEDIA_NOT_FOUND') }
    }

    if (template.header_media_id) {
      try { return await whatsappMetaApi.downloadMedia(config.access_token, template.header_media_id) } catch { /* expired — try the sample */ }
    }
    if (template.meta_template_id) {
      try {
        const sample = await whatsappMetaApi.getTemplateHeaderExample(config.access_token, template.meta_template_id)
        if (sample) return sample
      } catch { /* fall through */ }
    }
    throw new AppError(404, 'Header media is no longer available', 'MEDIA_NOT_FOUND')
  },

  // Carousel template: a message body plus 2-10 swipeable cards, each an image
  // with a short text and up to 2 buttons. Every card must have the same buttons
  // (same types, same count) - that is Meta's rule, enforced here before anything
  // is uploaded.
  async createCarousel(
    salonId: string,
    input: {
      name: string; language: string; body_text: string
      cards: Array<{ body: string; buttons: Array<{ type: string; text: string; value?: string }> }>
    },
    files: Express.Multer.File[]
  ) {
    const bad = (m: string) => new AppError(400, m, 'VALIDATION_ERROR')
    const { name, language, body_text, cards } = input
    if (!/^[a-z0-9_]+$/.test(name ?? '')) throw bad('name must be lowercase letters, numbers and underscores only')
    if (!language) throw bad('language is required')
    if (!body_text || body_text.trim().length < 10) throw bad('The message above the cards must be at least 10 characters')
    if (body_text.length > 1024) throw bad('The message above the cards must be under 1024 characters')
    if (!Array.isArray(cards) || cards.length < 2 || cards.length > 10) throw bad('A carousel needs between 2 and 10 cards')
    if (files.length !== cards.length) throw bad('Every card needs an image')

    const shape = cards[0].buttons.map(b => b.type).join(',')
    cards.forEach((c, i) => {
      const n = i + 1
      if (!c.body?.trim()) throw bad(`Card ${n}: text is required`)
      if (c.body.length > 160) throw bad(`Card ${n}: text is ${c.body.length} characters (max 160)`)
      if (/\{\{\s*\d+\s*\}\}/.test(c.body)) throw bad(`Card ${n}: variables are not supported in card text`)
      if (!c.buttons?.length || c.buttons.length > 2) throw bad(`Card ${n}: add 1 or 2 buttons`)
      if (c.buttons.map(b => b.type).join(',') !== shape) throw bad('Every card must have the same buttons (same types, same order)')
      c.buttons.forEach((b, j) => {
        if (!['quick_reply', 'url', 'phone'].includes(b.type)) throw bad(`Card ${n}: button ${j + 1} has an unsupported type`)
        if (!b.text?.trim() || b.text.length > 25) throw bad(`Card ${n}: button ${j + 1} text must be 1-25 characters`)
        if (b.type === 'url' && !/^https:\/\/\S+\.\S+/.test(b.value ?? '')) throw bad(`Card ${n}: button ${j + 1} link must start with https://`)
        if (b.type === 'phone' && !/^\+\d{8,15}$/.test((b.value ?? '').replace(/[\s-]/g, ''))) throw bad(`Card ${n}: button ${j + 1} phone must be in +91... format`)
      })
    })
    files.forEach((f, i) => {
      if (!['image/jpeg', 'image/png'].includes(f.mimetype)) throw bad(`Card ${i + 1}: image must be JPEG or PNG`)
      if (f.size > 5 * 1024 * 1024) throw bad(`Card ${i + 1}: image is larger than 5 MB`)
    })

    // Fail BEFORE touching Meta if the database can't store the cards.
    if (!(await templatesRepository.hasCarouselColumn())) {
      throw new AppError(500, 'Carousel templates need a one-time server setup - run Migration/add_wa_templates_carousel.sql', 'CAROUSEL_NOT_MIGRATED')
    }
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED')
    const appId = (config as any).app_id
    if (!appId) throw new AppError(400, 'app_id not configured in WhatsApp settings', 'WA_NOT_CONFIGURED')

    // Each card image goes to Meta twice: a "handle" Meta shows its reviewers, and
    // a media id we send with every message.
    const stored: Array<{ body: string; header_media_id: string; buttons: any[] }> = []
    const metaCards: any[] = []
    for (let i = 0; i < cards.length; i++) {
      let handle: string, mediaId: string
      try {
        handle  = await uploadMediaHandle(files[i], appId, config.access_token)
        mediaId = await uploadMediaId(files[i], config.phone_number_id, config.access_token)
      } catch (err: any) {
        const m = err?.response?.data?.error?.message
        throw new AppError(400, m ? `Failed to upload card ${i + 1} image: ${m}` : `Failed to upload card ${i + 1} image.`, 'MEDIA_UPLOAD_FAILED')
      }
      const c = cards[i]
      stored.push({ body: c.body.trim(), header_media_id: mediaId, buttons: c.buttons.map(b => ({ type: b.type, text: b.text.trim(), value: (b.value ?? '').trim() })) })
      metaCards.push({
        components: [
          { type: 'header', format: 'image', example: { header_handle: [handle] } },
          { type: 'body', text: c.body.trim() },
          {
            type: 'buttons',
            buttons: c.buttons.map(b => {
              if (b.type === 'quick_reply') return { type: 'quick_reply', text: b.text.trim() }
              if (b.type === 'url')         return { type: 'url', text: b.text.trim(), url: b.value!.trim() }
              return { type: 'phone_number', text: b.text.trim(), phone_number: b.value!.replace(/[\s-]/g, '') }
            }),
          },
        ],
      })
    }

    const bodyComponent: any = { type: 'BODY', text: body_text }
    const examples = extractExamples(body_text)
    if (examples.length > 0) bodyComponent.example = { body_text: [examples] }

    let metaTemplateId: string | undefined
    let status = 'PENDING'
    try {
      const meta = await whatsappMetaApi.submitTemplate({
        wabaId: config.waba_id, accessToken: config.access_token,
        name, category: 'MARKETING', language,
        components: [bodyComponent, { type: 'carousel', cards: metaCards }],
      })
      metaTemplateId = meta.id
      status = meta.status ?? 'PENDING'
    } catch (err: any) {
      // Unlike an ordinary template, say so: a rejected carousel submission is almost always a rule
      // about the cards, and the reason is what the user needs to fix it.
      const m = err?.response?.data?.error?.error_user_msg ?? err?.response?.data?.error?.message
      throw new AppError(400, `Meta rejected the carousel: ${m ?? err.message}`, 'META_REJECTED')
    }

    const created = await templatesRepository.create(salonId, {
      name, category: 'MARKETING', language, header_type: 'none', body_text,
      buttons: [], meta_template_id: metaTemplateId, status,
    } as any)
    await templatesRepository.setCarousel(created.id, stored)
    return { ...created, carousel: stored }
  },

  async create(salonId: string, body: CreateTemplateBody, file?: Express.Multer.File) {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED')

    const components: any[] = []
    let headerMediaId: string | undefined

    if (body.header_type && body.header_type !== 'none') {
      if (body.header_type === 'text' && body.header_text) {
        const headerExamples = extractExamples(body.header_text)
        const headerComponent: any = { type: 'HEADER', format: 'TEXT', text: body.header_text }
        if (headerExamples.length > 0) headerComponent.example = { header_text: headerExamples }
        components.push(headerComponent)

      } else if (file && ['image', 'video', 'document'].includes(body.header_type)) {
        // Validate BEFORE attempting any upload — same cap/message as
        // fixMedia() below. Previously unchecked here: an oversized file (or
        // any other upload failure) fell into the catch below, which swallowed
        // the error and silently created a template with NO media handle at
        // all. That template would only fail much later, at actual campaign
        // send time (campaign.processor.ts's MISSING_MEDIA_ID guard), with no
        // indication to the user that their image was ever the problem.
        const maxSize = MAX_HEADER_FILE_SIZE[body.header_type]
        if (maxSize && file.size > maxSize) {
          const maxMB = maxSize / (1024 * 1024)
          const fileMB = (file.size / (1024 * 1024)).toFixed(1)
          throw new AppError(
            400,
            `File is too large — max ${maxMB}MB for a ${body.header_type} header (received ${fileMB}MB)`,
            'VALIDATION_ERROR'
          )
        }

        const appId = (config as any).app_id
        if (!appId) throw new AppError(400, 'app_id not configured in WhatsApp settings', 'WA_NOT_CONFIGURED')

        let handle: string
        try {
          handle = await uploadMediaHandle(file, appId, config.access_token)
          headerMediaId = await uploadMediaId(file, config.phone_number_id, config.access_token)
        } catch (mediaErr: any) {
          const metaMsg = mediaErr?.response?.data?.error?.message
          console.error('❌ Media upload failed:', mediaErr?.response?.data ?? mediaErr?.message)
          // Surface the real failure instead of silently creating a broken,
          // header-less template — the user needs to know their file didn't
          // make it to Meta, and why, right here at creation time.
          throw new AppError(
            400,
            metaMsg
              ? `Failed to upload ${body.header_type} to WhatsApp: ${metaMsg}`
              : `Failed to upload ${body.header_type} to WhatsApp. Please try a smaller or different file.`,
            'MEDIA_UPLOAD_FAILED'
          )
        }

        const formatMap: Record<string, string> = { image: 'IMAGE', video: 'VIDEO', document: 'DOCUMENT' }
        components.push({
          type:    'HEADER',
          format:  formatMap[body.header_type],
          example: { header_handle: [handle] },
        })
      } else {
        components.push({ type: 'HEADER', format: body.header_type.toUpperCase() })
      }
    }

    // Limited-time offer: the countdown badge. Its text is fixed here; the actual
    // expiry timestamp is supplied on every send (see buildOfferComponents).
    if (body.lto_text) {
      components.push({ type: 'limited_time_offer', limited_time_offer: { text: body.lto_text, has_expiration: true } })
    }

    const bodyExamples = extractExamples(body.body_text)
    const bodyComponent: any = { type: 'BODY', text: body.body_text }
    if (bodyExamples.length > 0) bodyComponent.example = { body_text: [bodyExamples] }
    components.push(bodyComponent)

    if (body.footer_text) {
      components.push({ type: 'FOOTER', text: body.footer_text })
    }

    if (body.buttons && body.buttons.length > 0) {
      components.push({
        type:    'BUTTONS',
        buttons: body.buttons.map(b => {
          if (b.type === 'quick_reply') return { type: 'QUICK_REPLY',  text: b.text }
          if (b.type === 'url')         return { type: 'URL',          text: b.text, url: b.value }
          if (b.type === 'phone')       return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.value }
          // "Copy offer code" — `example` is only the sample Meta reviews; the
          // real code is supplied on every send.
          if (b.type === 'copy_code')   return { type: 'COPY_CODE',    example: b.value }
          // Opens a published WhatsApp Flow straight from the template (value = flow id).
          // Created only by the booking-form invitation, never from the template form.
          if (b.type === 'flow')        return { type: 'FLOW', text: b.text, flow_id: b.value, flow_action: 'navigate', navigate_screen: 'BOOKING' }
          return null
        }).filter(Boolean),
      })
    }

    let metaTemplateId: string | undefined
    let status = 'PENDING'

    try {
      const meta = await whatsappMetaApi.submitTemplate({
        wabaId:      config.waba_id,
        accessToken: config.access_token,
        name:        body.name,
        category:    body.category,
        language:    body.language,
        components,
      })
      metaTemplateId = meta.id
      status         = meta.status ?? 'PENDING'
    } catch (err: any) {
      console.error('Meta submission error:', err?.response?.data ?? err?.message)
    }

    return templatesRepository.create(salonId, {
      ...body,
      meta_template_id: metaTemplateId,
      header_media_id:  headerMediaId,
      status,
    })
  },

  async syncStatus(id: string, salonId: string) {
    const template = await templatesRepository.findById(id, salonId)
    if (!template) throw new AppError(404, 'Template not found', 'NOT_FOUND')

    // A missing meta_template_id means this template was never actually
    // accepted by Meta (its initial submitTemplate() call in create() failed
    // and was silently swallowed) — there is nothing to "sync" and it must
    // never resolve to APPROVED, or a campaign can launch against a template
    // that doesn't exist on Meta's side, failing every send with 132001
    // ("Template name does not exist in the translation"). This was the
    // actual root cause of a real failed campaign (2026-09-22).
    if (!template.meta_template_id) {
      return templatesRepository.updateStatus(
        id, 'REJECTED', null,
        'Never successfully submitted to Meta — recreate this template to use it in a campaign.'
      )
    }

    const config = await configRepository.findBySalonId(salonId)
    if (!config) {
      // Can't verify against Meta right now (WhatsApp disconnected after
      // this template was created) — leave the existing status untouched
      // rather than guessing either way.
      return template
    }

    try {
      const meta = await whatsappMetaApi.getTemplateStatus(
        config.access_token,
        template.meta_template_id
      )
      return templatesRepository.updateStatus(
        id,
        meta.status,
        template.meta_template_id,
        meta.rejected_reason ?? null
      )
    } catch (err: any) {
      // Meta returning "this object doesn't exist" means the template was
      // deleted on Meta's side (directly in Business Manager, or by Meta
      // itself) — surface that as REJECTED so campaigns stop being launched
      // against a template that will fail every single send with 132001
      // ("Template name does not exist in the translation"). Previously this
      // blindly forced status back to APPROVED on ANY error (including this
      // one), which is exactly backwards — it hid the deletion instead of
      // catching it.
      const status  = err?.response?.status
      const message = String(err?.response?.data?.error?.message ?? '').toLowerCase()
      const isDeleted = status === 404 || status === 400 && message.includes('does not exist')
      if (isDeleted) {
        return templatesRepository.updateStatus(
          id, 'REJECTED', null,
          'Deleted on Meta’s side — recreate this template to use it in a campaign again.'
        )
      }
      // A genuinely transient failure (network blip, auth hiccup) — leave
      // the template's current status untouched rather than guessing.
      return template
    }
  },

  async toggleFavorite(id: string, salonId: string) {
    const result = await templatesRepository.toggleFavorite(id, salonId)
    if (!result) throw new AppError(404, 'Template not found', 'NOT_FOUND')
    return result
  },

  async fixMedia(id: string, salonId: string, file: Express.Multer.File) {
    const template = await templatesRepository.findById(id, salonId)
    if (!template) throw new AppError(404, 'Template not found', 'NOT_FOUND')
    if (!template.header_type || template.header_type === 'none' || template.header_type === 'text') {
      throw new AppError(400, 'This template does not have a media header', 'NO_MEDIA_HEADER')
    }
    const maxSize = MAX_HEADER_FILE_SIZE[template.header_type]
    if (maxSize && file.size > maxSize) {
      const maxMB = maxSize / (1024 * 1024)
      const fileMB = (file.size / (1024 * 1024)).toFixed(1)
      throw new AppError(
        400,
        `File is too large — max ${maxMB}MB for a ${template.header_type} header (received ${fileMB}MB)`,
        'VALIDATION_ERROR'
      )
    }
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')

    const mediaId = await uploadMediaId(file, config.phone_number_id, config.access_token)
    return templatesRepository.updateMediaId(id, salonId, mediaId)
  },

  async delete(id: string, salonId: string) {
    const result = await templatesRepository.delete(id, salonId)

    if (!result.deleted && result.reason === 'IN_USE') {
      throw new AppError(
        409,
        `Cannot delete — this template is used in ${result.campaignCount} campaign(s). Delete those campaigns first.`,
        'TEMPLATE_IN_USE'
      )
    }

    if (!result.deleted) throw new AppError(404, 'Template not found', 'NOT_FOUND')
    return { message: 'Template deleted successfully' }
  },
}