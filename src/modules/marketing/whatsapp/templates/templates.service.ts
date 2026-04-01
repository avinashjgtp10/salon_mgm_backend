import { AppError } from '../../../../middleware/error.middleware'
import { templatesRepository } from './templates.repository'
import { configRepository } from '../config/config.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { CreateTemplateBody } from './templates.types'

export const templatesService = {

  async getAll(salonId: string) {
    return templatesRepository.findAll(salonId)
  },

  async getById(id: string, salonId: string) {
    const t = await templatesRepository.findById(id, salonId)
    if (!t) throw new AppError(404, 'Template not found', 'NOT_FOUND')
    return t
  },

  async create(salonId: string, body: CreateTemplateBody) {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED')

    const components: any[] = []

    if (body.header_type && body.header_type !== 'none') {
      if (body.header_type === 'text' && body.header_text) {
        components.push({ type: 'HEADER', format: 'TEXT', text: body.header_text })
      } else if (['image', 'video', 'document'].includes(body.header_type)) {
        components.push({ type: 'HEADER', format: body.header_type.toUpperCase() })
      }
    }

    components.push({ type: 'BODY', text: body.body_text })

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
        }),
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
    } catch {
      // Save locally even if Meta submission fails
    }

    return templatesRepository.create(salonId, {
      ...body,
      meta_template_id: metaTemplateId,
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

  async delete(id: string, salonId: string) {
    const deleted = await templatesRepository.delete(id, salonId)
    if (!deleted) throw new AppError(404, 'Template not found', 'NOT_FOUND')
    return { message: 'Template deleted successfully' }
  },
}
