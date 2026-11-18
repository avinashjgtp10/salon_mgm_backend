// "Send test": send one chain message to a WhatsApp number the user enters (their own phone if none is given), so an owner can see exactly what a client would
// receive before activating a chain. It goes through the same template/variable code as the real sender, but writes nothing
// to the journey log or the Inbox. Every test is a real, billed WhatsApp message, hence the per-user hourly limit.
import pool from '../../config/database'
import redis from '../../config/redis'
import logger from '../../config/logger'
import { AppError } from '../../middleware/error.middleware'
import { getSalonTimezone } from '../../config/salonTimezone'
import { configRepository } from '../marketing/whatsapp/config/config.repository'
import { whatsappMetaApi } from '../marketing/whatsapp/shared/whatsapp.api'
import { buildTemplateSendComponents, templateHasMediaHeader } from '../marketing/whatsapp/shared/template-components'
import { formatPhone } from '../whatsapp-automation/whatsapp-automation.service'
import { maskPhone } from '../utils/mask.util'
import { CHAIN_VARIABLE_FIELDS, type ChainVariableField } from './service-chains.types'
import { resolveVariables } from './service-chains.runner'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMIT_PER_HOUR = 10
const bad = (message: string, code = 'VALIDATION_ERROR') => new AppError(400, message, code)

interface TestSendInput {
  template_id: string
  variable_map?: Record<string, ChainVariableField>
  starting_service_id?: string | null
  step_service_id?: string | null
  // The WhatsApp number to send the test to (any format with the country code). Falls back to the user's profile phone.
  to_phone?: string | null
}

export async function sendTestMessage(salonId: string, userId: string, input: TestSendInput): Promise<{ sent_to: string }> {
  if (!UUID.test(String(input?.template_id ?? ''))) throw bad('Choose a template first')

  const { rows: [user] } = await pool.query(`SELECT first_name, phone, country_code FROM users WHERE id = $1`, [userId])
  const typed = String(input.to_phone ?? '').replace(/\D/g, '')
  if (typed && (typed.length < 8 || typed.length > 15)) throw bad('Enter a valid WhatsApp number with the country code')
  if (!typed && !String(user?.phone ?? '').trim()) throw bad('Enter the WhatsApp number to send the test to', 'NO_PHONE')

  const { rows: [t] } = await pool.query(
    `SELECT id, name, language, status, body_text, header_type, header_media_id, buttons,
            to_jsonb(wa_templates)->>'lto_text' AS lto_text, to_jsonb(wa_templates)->'carousel' AS carousel
     FROM wa_templates WHERE id = $1 AND salon_id = $2`, [input.template_id, salonId])
  if (!t) throw new AppError(404, 'Template not found', 'NOT_FOUND')
  if (t.status !== 'APPROVED') throw bad('Only a template Meta has approved can be sent as a test', 'TEMPLATE_NOT_APPROVED')
  if (templateHasMediaHeader(t) && !t.header_media_id) throw bad('This template has a media header but no media is stored for it', 'MISSING_MEDIA_ID')

  const map: Record<string, ChainVariableField> = {}
  for (const [k, v] of Object.entries(input.variable_map ?? {})) {
    if (/^\d{1,2}$/.test(k) && (CHAIN_VARIABLE_FIELDS as readonly string[]).includes(v as string)) map[k] = v as ChainVariableField
  }
  const missing = [...new Set((String(t.body_text ?? '').match(/\{\{(\d+)\}\}/g) ?? []).map((m: string) => m.replace(/\D/g, '')))].filter((slot) => !map[slot])
  if (missing.length) throw bad(`Choose a value for {{${missing[0]}}} before sending a test`)

  const config = await configRepository.findBySalonId(salonId)
  if (!config?.phone_number_id || !config?.access_token) throw new AppError(400, 'WhatsApp is not connected for this salon', 'WA_NOT_CONFIGURED')

  // Real, billed messages: cap how many one person can fire off.
  const key = `service-chain:test-send:${userId}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 3600)
  if (count > LIMIT_PER_HOUR) throw new AppError(429, 'Too many test messages. Try again in an hour.', 'RATE_LIMITED')

  const serviceName = async (id?: string | null) => {
    if (!id || !UUID.test(id)) return ''
    const { rows } = await pool.query(`SELECT name FROM services WHERE id = $1 AND salon_id = $2`, [id, salonId])
    return rows[0]?.name ?? ''
  }
  const { rows: [salon] } = await pool.query(`SELECT business_name FROM salons WHERE id = $1`, [salonId])
  const tz = await getSalonTimezone(salonId)
  const sample = {
    client_name: user.first_name, salon_name: salon?.business_name,
    starting_service_name: await serviceName(input.starting_service_id), step_service_name: await serviceName(input.step_service_id),
    purchased_at: new Date(),
  }
  const variables = resolveVariables(map, sample, tz)

  const to = `+${typed || formatPhone(String(user.phone), user.country_code).replace(/\D/g, '')}`
  try {
    await whatsappMetaApi.sendTemplateMessage({
      phoneNumberId: config.phone_number_id, accessToken: config.access_token, to,
      templateName: t.name, language: t.language,
      components: buildTemplateSendComponents(t, { variables, fallbackName: user.first_name, flowToken: `${salonId}:chain:test` }),
    })
  } catch (err: any) {
    const message = err?.response?.data?.error?.message ?? err?.message ?? 'Send failed'
    logger.warn('[service-chain] test send failed', { salonId, message })
    throw new AppError(400, `WhatsApp could not send the test: ${message}`, 'SEND_FAILED')
  }
  logger.info(`[service-chain] test message sent to ${maskPhone(to)}`, { salonId })
  return { sent_to: maskPhone(to) }
}
