import pool from '../../../../config/database'
import logger from '../../../../config/logger'
import { AppError } from '../../../../middleware/error.middleware'
import { configRepository } from '../config/config.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { inboxRepository } from '../inbox/inbox.repository'
import { inboxService } from '../inbox/inbox.service'
import { enquiriesService } from '../../../enquiries/enquiries.service'
import { notificationsService } from '../../../notifications/notifications.service'
import { getIO } from '../../../../config/socket'
import { templatesService } from '../templates/templates.service'
import { BookingFormConfig, DEFAULT_BOOKING_CONFIG, MAX_SERVICES as DROPDOWN_CAP, normalizeBookingConfig, timeOptions } from './booking-form.config'

// Flow JSON schema version. Meta freezes old versions (5.0 can no longer be
// published as of Sept 2025) and currently recommends 7.3. If Meta rejects this
// one too, set WA_FLOW_JSON_VERSION in the environment (no code change needed)
// - the error Meta returns is shown in the Inbox.
const FLOW_JSON_VERSION = process.env.WA_FLOW_JSON_VERSION ?? '7.3'
const BOOKING_SCREEN    = 'BOOKING'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  if (phone.startsWith('+'))                           return '+' + digits
  if (digits.length === 10)                            return '+91' + digits
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits
  return '+' + digits
}

// Builds the form from the salon's saved choices (a plain request form - staff
// confirm the real slot, so times are preferences, not live availability). Only
// enabled questions are emitted, and the submit payload must reference exactly
// those: a payload pointing at a field the form does not have is a Meta
// validation error.
function buildBookingFlowJson(services: Array<{ id: string; name: string }>, cfg: BookingFormConfig) {
  const f = cfg.fields
  const children: any[] = [
    { type: 'TextInput', name: 'name', label: f.name.label, 'input-type': 'text', required: f.name.required },
  ]
  if (f.service.enabled) {
    children.push({
      type: 'Dropdown', name: 'service', label: f.service.label, required: f.service.required,
      'data-source': services.map(s => ({ id: s.id, title: s.name.slice(0, 30) })),
    })
  }
  if (f.other.enabled) {
    children.push({ type: 'TextInput', name: 'other_service', label: f.other.label, 'input-type': 'text', required: f.other.required })
  }
  if (f.date.enabled) children.push({ type: 'DatePicker', name: 'date', label: f.date.label, required: f.date.required })
  if (f.time.enabled) {
    children.push({ type: 'Dropdown', name: 'time', label: f.time.label, required: f.time.required, 'data-source': timeOptions(cfg) })
  }
  if (f.notes.enabled) children.push({ type: 'TextArea', name: 'notes', label: f.notes.label, required: f.notes.required })

  const payload: Record<string, string> = {}
  for (const c of children) payload[c.name] = '${form.' + c.name + '}'

  children.push({ type: 'Footer', label: cfg.buttonLabel, 'on-click-action': { name: 'complete', payload } })

  return {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: BOOKING_SCREEN,
      title: cfg.title,
      terminal: true,
      success: true,
      layout: {
        type: 'SingleColumnLayout',
        children: [{ type: 'Form', name: 'form', children }],
      },
    }],
  }
}

export const flowsService = {

  // The owner's saved form choices, merged over the built-in defaults. A salon
  // that never edited anything - or a server where the config migration has not
  // run yet - simply gets the defaults. `updated_at` lets the UI tell whether
  // edits were saved after the form was last published.
  async getBookingConfig(salonId: string): Promise<{ config: BookingFormConfig; updated_at: string | null; migrated: boolean }> {
    try {
      const { rows } = await pool.query(
        `SELECT config, updated_at FROM wa_booking_form_config WHERE salon_id = $1`, [salonId]
      )
      if (!rows[0]) return { config: DEFAULT_BOOKING_CONFIG, updated_at: null, migrated: true }
      return { config: normalizeBookingConfig(rows[0].config).config, updated_at: rows[0].updated_at, migrated: true }
    } catch (err: any) {
      if (err?.code === '42P01') return { config: DEFAULT_BOOKING_CONFIG, updated_at: null, migrated: false }   // undefined_table
      throw err
    }
  },

  // Saves the edits only - nothing reaches customers until publishBookingFlow.
  async saveBookingConfig(salonId: string, input: any) {
    const { config, error } = normalizeBookingConfig(input)
    if (error) throw new AppError(400, error, 'FORM_CONFIG_INVALID')
    try {
      const { rows: [r] } = await pool.query(
        `INSERT INTO wa_booking_form_config (salon_id, config) VALUES ($1, $2::jsonb)
         ON CONFLICT (salon_id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
         RETURNING updated_at`,
        [salonId, JSON.stringify(config)]
      )
      return { config, updated_at: r.updated_at as string }
    } catch (err: any) {
      if (err?.code === '42P01') {
        throw new AppError(500, 'Editing the booking form needs a one-time server setup - run Migration/create_wa_booking_form_config.sql', 'FLOWS_NOT_MIGRATED')
      }
      throw err
    }
  },

  // flow=null means never created. migrated=false means the wa_booking_flows
  // table does not exist yet (Migration/create_wa_booking_flows.sql not run).
  async getBookingFlow(salonId: string): Promise<{ migrated: boolean; flow: { flow_id: string; updated_at: string; auto_send: boolean } | null }> {
    try {
      // auto_send comes from Migration/add_wa_booking_flows_auto_send.sql; read via
      // to_jsonb so this still works on a database that has not run it yet.
      const { rows } = await pool.query(
        `SELECT flow_id, updated_at, COALESCE((to_jsonb(f)->>'auto_send')::boolean, false) AS auto_send
         FROM wa_booking_flows f WHERE salon_id = $1`, [salonId]
      )
      return { migrated: true, flow: rows[0] ?? null }
    } catch (err: any) {
      if (err?.code === '42P01') return { migrated: false, flow: null }   // undefined_table
      throw err
    }
  },

  // The invitation template: a marketing template whose button opens the booking
  // form directly, so it can be sent OUTSIDE the 24-hour window (campaigns, or the
  // Inbox when the customer hasn't written in a day). A published Flow can't be
  // edited, so a template points at one specific flow id - when the form is
  // published again the old invitation is 'stale' and has to be created anew.
  async getInviteTemplate(salonId: string): Promise<{ id: string; name: string; status: string; stale: boolean } | null> {
    const state = await this.getBookingFlow(salonId)
    const { rows } = await pool.query(
      `SELECT id, name, status, buttons FROM wa_templates
       WHERE salon_id = $1 AND buttons @> '[{"type":"flow"}]'::jsonb
       ORDER BY created_at DESC LIMIT 1`,
      [salonId]
    )
    const t = rows[0]
    if (!t) return null
    const flowBtn = (t.buttons ?? []).find((b: any) => b.type === 'flow')
    return { id: t.id, name: t.name, status: t.status, stale: !!state.flow && flowBtn?.value !== state.flow.flow_id }
  },

  async createInviteTemplate(salonId: string) {
    const state = await this.getBookingFlow(salonId)
    if (!state.flow) throw new AppError(400, 'Create the booking form first', 'FLOW_NOT_CREATED')
    const existing = await this.getInviteTemplate(salonId)
    if (existing && !existing.stale && existing.status !== 'REJECTED') {
      throw new AppError(400, 'An invitation template for the current booking form already exists', 'INVITE_EXISTS')
    }
    // Names are unique per salon: tie it to the flow id so a re-created form gets a fresh one.
    const name = `booking_form_invite_${state.flow.flow_id.slice(-6)}`
    return templatesService.create(salonId, {
      name,
      category: 'MARKETING',
      language: 'en_US',
      header_type: 'none',
      body_text: 'Hi {{1}}, book your next appointment with us in just a few taps — pick a service, date and time.',
      footer_text: 'Reply STOP to unsubscribe',
      buttons: [{ type: 'flow', text: 'Book now', value: state.flow.flow_id }],
    } as any)
  },

  async setAutoSend(salonId: string, enabled: boolean) {
    const state = await this.getBookingFlow(salonId)
    if (!state.flow) throw new AppError(400, 'Create the booking form first', 'FLOW_NOT_CREATED')
    try {
      await pool.query(`UPDATE wa_booking_flows SET auto_send = $2, updated_at = updated_at WHERE salon_id = $1`, [salonId, enabled])
    } catch (err: any) {
      if (err?.code === '42703') {   // undefined_column
        throw new AppError(500, 'Auto-send needs a one-time server setup - run Migration/add_wa_booking_flows_auto_send.sql', 'FLOWS_NOT_MIGRATED')
      }
      throw err
    }
    return { auto_send: enabled }
  },

  // The customer's previous message time, read BEFORE the new one is stored -
  // lets the webhook tell "first reply after a closed window" from "mid-chat".
  async getLastInboundAt(salonId: string, phone: string): Promise<Date | null> {
    const { rows: [r] } = await pool.query(
      `SELECT MAX(m.sent_at) AS t FROM wa_messages m JOIN wa_conversations c ON c.id = m.conversation_id
       WHERE c.salon_id = $1 AND c.contact_phone = $2 AND m.direction = 'INBOUND'`,
      [salonId, normalizePhone(phone)]
    )
    return r?.t ? new Date(r.t) : null
  },

  // Called from the webhook for every ordinary inbound message. Sends the form
  // automatically ONLY when: the salon turned it on, this reply re-opens a window
  // that had been closed (no earlier message in the last 24h - e.g. a reply to a
  // campaign), and we have not already sent them a form in the last 24h.
  async autoSendOnReply(salonId: string, phone: string, prevInboundAt: Date | null) {
    if (prevInboundAt && Date.now() - prevInboundAt.getTime() < 24 * 3600 * 1000) return   // already mid-conversation
    const state = await this.getBookingFlow(salonId)
    if (!state.flow?.auto_send) return

    const normalizedPhone = normalizePhone(phone)
    const { rows: [recent] } = await pool.query(
      `SELECT 1 FROM wa_messages m JOIN wa_conversations c ON c.id = m.conversation_id
       WHERE c.salon_id = $1 AND c.contact_phone = $2 AND m.direction = 'OUTBOUND'
         AND m.body = '📋 Booking form sent' AND m.sent_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
      [salonId, normalizedPhone]
    )
    if (recent) return

    // A momentary network failure reaching Meta (timeout / unreachable / reset)
    // would otherwise silently lose the form - there is no human watching an
    // automatic send. Retry those a couple of times; anything else (window closed,
    // Meta rejecting the message) is final.
    const isNetworkBlip = (e: any) => /ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN|ECONNREFUSED|socket hang up/i.test(String(e?.message ?? ''))
    let message: Awaited<ReturnType<typeof this.sendBookingFlow>> | undefined
    try {
      for (let attempt = 0; attempt < 3 && !message; attempt++) {
        try {
          message = await this.sendBookingFlow(salonId, phone)
        } catch (err: any) {
          if (attempt === 2 || !isNetworkBlip(err)) throw err
          await new Promise(r => setTimeout(r, 4000))
        }
      }
    } catch (err: any) {
      // Never fail silently: the customer replied expecting the form, so tell
      // staff to send it by hand.
      notificationsService.create({
        salon_id: salonId, type: 'whatsapp',
        title: 'Booking form not sent',
        body:  `Could not auto-send the booking form to ${normalizedPhone}. Open the chat and send it manually.`,
        event_key: 'newMessage', contact_phone: phone,
      }).catch(() => {})
      throw err
    }
    if (!message) return
    try {
      const io = getIO()
      io.to(`salon:${salonId}`).emit('inbox:message', { salonId, contactPhone: normalizedPhone, contactName: null, message })
    } catch { /* live push is best-effort */ }
  },

  // Builds the form from the salon's active services and publishes it on Meta.
  // Published flows are immutable, so "update" = publish a fresh one and swap
  // the stored id.
  async publishBookingFlow(salonId: string) {
    const state = await this.getBookingFlow(salonId)
    if (!state.migrated) {
      throw new AppError(500, 'Booking forms are not set up on this server yet - run Migration/create_wa_booking_flows.sql', 'FLOWS_NOT_MIGRATED')
    }
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')

    const { config: formConfig } = await this.getBookingConfig(salonId)
    // The owner's chosen services (still-active ones only), else every active
    // service. A Meta dropdown holds 200 - never cut the list silently, make the
    // owner choose.
    const { rows: services } = await pool.query(
      `SELECT id::text AS id, name FROM services
       WHERE salon_id = $1 AND is_active = true AND ($2::text[] IS NULL OR id::text = ANY($2::text[]))
       ORDER BY name ASC`,
      [salonId, formConfig.serviceIds]
    )
    if (formConfig.fields.service.enabled) {
      if (services.length === 0) {
        throw new AppError(400, 'Add at least one active service first, or turn off the Service question', 'NO_SERVICES')
      }
      if (services.length > DROPDOWN_CAP) {
        throw new AppError(400, `You have ${services.length} active services but a WhatsApp dropdown holds ${DROPDOWN_CAP}. Open Customise form and choose which services to offer.`, 'SERVICES_OVER_LIMIT')
      }
    }

    let result: any
    try {
      result = await whatsappMetaApi.createFlow({
        wabaId:      config.waba_id,
        accessToken: config.access_token,
        name:        `salonox_booking_${Date.now()}`,
        flowJson:    buildBookingFlowJson(services, formConfig),
        publish:     true,
      })
    } catch (err: any) {
      const msg = err?.response?.data?.error?.error_user_msg ?? err?.response?.data?.error?.message ?? err.message
      throw new AppError(400, `Meta rejected the booking form: ${msg}`, 'FLOW_CREATE_FAILED')
    }

    const errors: any[] = result?.validation_errors ?? []
    if (!result?.id || errors.length > 0) {
      const detail = errors.map(e => e.message ?? e.error).filter(Boolean).slice(0, 3).join(' | ')
      throw new AppError(400, `Booking form has validation errors: ${detail || 'unknown'}`, 'FLOW_INVALID')
    }

    await pool.query(
      `INSERT INTO wa_booking_flows (salon_id, flow_id) VALUES ($1, $2)
       ON CONFLICT (salon_id) DO UPDATE SET flow_id = EXCLUDED.flow_id, updated_at = NOW()`,
      [salonId, String(result.id)]
    )
    return { flow_id: String(result.id), services: services.length }
  },

  // Every active service, for the owner's picker in Customise form.
  async listServicesForPicker(salonId: string) {
    const { rows } = await pool.query(
      `SELECT s.id::text AS id, s.name, COALESCE(c.name, 'Other') AS category
       FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE s.salon_id = $1 AND s.is_active = true
       ORDER BY COALESCE(c.name, 'Other') ASC, s.name ASC`,
      [salonId]
    )
    return rows as Array<{ id: string; name: string; category: string }>
  },

  // Sends the published form to one customer. Interactive messages are only
  // deliverable inside the 24h window - Meta rejects it otherwise.
  async sendBookingFlow(salonId: string, phone: string) {
    const normalizedPhone = normalizePhone(phone)
    const state = await this.getBookingFlow(salonId)
    if (!state.flow) throw new AppError(400, 'Create the booking form first', 'FLOW_NOT_CREATED')
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')

    // Meta accepts an interactive message at send time and only rejects it later
    // (error 131047, shown as "Not delivered") when the customer hasn't written
    // in the last 24h. Refuse up front, using the thread we already have, so
    // staff get a clear reason instead of a failed bubble.
    const { rows: [lastIn] } = await pool.query(
      `SELECT MAX(m.sent_at) AS last_in
       FROM wa_messages m JOIN wa_conversations c ON c.id = m.conversation_id
       WHERE c.salon_id = $1 AND c.contact_phone = $2 AND m.direction = 'INBOUND'`,
      [salonId, normalizedPhone]
    )
    const lastInAt = lastIn?.last_in ? new Date(lastIn.last_in).getTime() : 0
    if (!lastInAt || Date.now() - lastInAt > 24 * 3600 * 1000) {
      throw new AppError(
        400,
        'This customer has not messaged you in the last 24 hours, so WhatsApp will not deliver the booking form. Send an approved template (paperclip) and send the form once they reply.',
        'WINDOW_CLOSED'
      )
    }

    const bodyText = 'Tap below to request your appointment and our team will confirm.'
    let result: any
    try {
      result = await whatsappMetaApi.sendFlowMessage({
        phoneNumberId: config.phone_number_id,
        accessToken:   config.access_token,
        to:            normalizedPhone,
        flowId:        state.flow.flow_id,
        flowToken:     `${salonId}:${Date.now()}`,
        screen:        BOOKING_SCREEN,
        bodyText,
        buttonText:    'Book appointment',
      })
    } catch (err: any) {
      const code = err?.response?.data?.error?.code
      if (code === 131047) {
        throw new AppError(400, 'The 24-hour window is closed - the customer must message you first', 'WINDOW_CLOSED')
      }
      const msg = err?.response?.data?.error?.message ?? err.message
      throw new AppError(400, `Could not send the booking form: ${msg}`, 'FLOW_SEND_FAILED')
    }

    const wamid = result?.messages?.[0]?.id ?? null
    const preview = '📋 Booking form sent'
    const conversationId = await inboxRepository.upsertConversation(salonId, normalizedPhone, null, preview, false)
    return inboxRepository.insertMessage({
      conversationId, salonId, direction: 'OUTBOUND', body: preview, wamid, status: 'SENT',
    })
  },

  // A customer submitted the form. Turns it into an Enquiry (status New) so it
  // shows up in the existing Enquiries list/reports, drops a readable line in
  // the thread, notifies staff, and confirms to the customer.
  async handleBookingResponse(salonId: string, fromPhone: string, profileName: string | null, wamid: string, responseJson: string) {
    let resp: Record<string, any> = {}
    try { resp = JSON.parse(responseJson || '{}') } catch { /* leave empty */ }

    const name  = String(resp.name || profileName || 'WhatsApp customer').trim()
    const date  = String(resp.date || '').trim()
    const time  = String(resp.time || '').trim()
    const notes = String(resp.notes || '').trim()
    const otherService = String(resp.other_service || '').trim()
    const svcId = UUID_RE.test(String(resp.service || '')) ? String(resp.service) : null

    let serviceName: string | null = null
    if (svcId) {
      const { rows } = await pool.query(`SELECT name FROM services WHERE id = $1 AND salon_id = $2`, [svcId, salonId])
      serviceName = rows[0]?.name ?? null
    }

    const when = [date, time].filter(Boolean).join(' ')
    const serviceLabel = [serviceName, otherService && `other: ${otherService}`].filter(Boolean).join(' + ') || 'service not specified'
    const summary = `📋 Booking request - ${serviceLabel}${when ? `, ${when}` : ''}${notes ? ` · ${notes}` : ''}`

    // Thread line (the customer's submission) + unread bump
    await inboxService.handleInboundMessage({ salonId, phone: fromPhone, name: profileName ?? name, body: summary, wamid })

    // Enquiry - its phone must be a 10-digit number, so a non-Indian number
    // simply skips this step (the thread line + notification still happen).
    const last10 = fromPhone.replace(/\D/g, '').slice(-10)
    try {
      await enquiriesService.create({
        name,
        phone:        last10,
        service_id:   svcId,
        status:       'New',
        source:       'WhatsApp Flow',
        notes:        `Preferred: ${when || 'not given'}${otherService ? `\nOther service: ${otherService}` : ''}${notes ? `\n${notes}` : ''}`,
        follow_up_at: date && time ? `${date} ${time}` : null,
      }, salonId)
    } catch (err: any) {
      logger.warn('Booking flow: could not create enquiry', { salonId, message: err?.message })
    }

    notificationsService.create({
      salon_id: salonId, type: 'whatsapp',
      title: `Booking request: ${name}`,
      body:  summary.length > 80 ? summary.slice(0, 77) + '…' : summary,
      event_key: 'newMessage', contact_phone: fromPhone,
    }).catch(() => {})

    // Confirmation - free-form is fine, the customer just interacted.
    try {
      await inboxService.sendReply(
        salonId, fromPhone,
        `Thanks ${name}! We've received your request${serviceName ? ` for ${serviceName}` : ''}${when ? ` on ${when}` : ''}. Our team will confirm your appointment shortly.`
      )
    } catch (err: any) {
      logger.warn('Booking flow: confirmation reply failed', { salonId, message: err?.message })
    }
  },
}
