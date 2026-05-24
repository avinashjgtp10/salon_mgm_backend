import axios from 'axios'
import FormData from 'form-data'
import { AppError } from '../../../../middleware/error.middleware'
import { templatesRepository } from './templates.repository'
import { configRepository } from '../config/config.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { CreateTemplateBody } from './templates.types'

const WA_BASE_URL    = process.env.WA_BASE_URL    ?? 'https://graph.facebook.com'
const WA_API_VERSION = process.env.WA_API_VERSION ?? 'v19.0'

function extractExamples(text: string): string[] {
  const matches = text.match(/{{\d+}}/g) ?? []
  return matches
    .map(m => parseInt(m.replace(/[{}]/g, '')))
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
        try {
          const appId = (config as any).app_id
          if (!appId) throw new Error('app_id not configured in WhatsApp settings')
          const handle = await uploadMediaHandle(file, appId, config.access_token)
          headerMediaId = await uploadMediaId(file, config.phone_number_id, config.access_token)
          const formatMap: Record<string, string> = { image: 'IMAGE', video: 'VIDEO', document: 'DOCUMENT' }
          components.push({
            type:    'HEADER',
            format:  formatMap[body.header_type],
            example: { header_handle: [handle] },
          })
        } catch (mediaErr: any) {
          console.error('❌ Media upload failed:', mediaErr?.response?.data ?? mediaErr?.message)
          components.push({ type: 'HEADER', format: body.header_type.toUpperCase() })
        }
      } else {
        components.push({ type: 'HEADER', format: body.header_type.toUpperCase() })
      }
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

    const config = await configRepository.findBySalonId(salonId)
    if (!config || !template.meta_template_id) {
      return templatesRepository.updateStatus(id, 'APPROVED')
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
    } catch {
      return templatesRepository.updateStatus(id, 'APPROVED')
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