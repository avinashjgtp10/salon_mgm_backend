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

// Flow JSON schema version. Meta freezes old versions (5.0 can no longer be
// published as of Sept 2025) and currently recommends 7.3. If Meta rejects this
// one too, set WA_FLOW_JSON_VERSION in the environment (no code change needed)
// - the error Meta returns is shown in the Inbox.
const FLOW_JSON_VERSION = process.env.WA_FLOW_JSON_VERSION ?? '7.3'
const BOOKING_SCREEN    = 'BOOKING'
const MAX_SERVICES      = 200   // Meta's dropdown cap
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  if (phone.startsWith('+'))                           return '+' + digits
  if (digits.length === 10)                            return '+91' + digits
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits
  return '+' + digits
}

// 30-minute slots, 10:00 AM - 8:00 PM. A plain request form - staff confirm the
// real slot, so these are preferences, not live availability.
function timeOptions() {
  const out: Array<{ id: string; title: string }> = []
  for (let m = 10 * 60; m <= 20 * 60; m += 30) {
    const h24 = Math.floor(m / 60), mm = m % 60
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    out.push({
      id:    `${String(h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      title: `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`,
    })
  }
  return out
}

function buildBookingFlowJson(services: Array<{ id: string; name: string }>) {
  return {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: BOOKING_SCREEN,
      title: 'Book Appointment',
      terminal: true,
      success: true,
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form',
          name: 'form',
          children: [
            { type: 'TextInput', name: 'name', label: 'Your name', 'input-type': 'text', required: true },
            {
              type: 'Dropdown', name: 'service', label: 'Service', required: true,
              'data-source': services.map(s => ({ id: s.id, title: s.name.slice(0, 30) })),
            },
            { type: 'DatePicker', name: 'date', label: 'Preferred date', required: true },
            { type: 'Dropdown', name: 'time', label: 'Preferred time', required: true, 'data-source': timeOptions() },
            { type: 'TextArea', name: 'notes', label: 'Anything else? (optional)', required: false },
            {
              type: 'Footer',
              label: 'Request appointment',
              'on-click-action': {
                name: 'complete',
                payload: {
                  name:    '${form.name}',
                  service: '${form.service}',
                  date:    '${form.date}',
                  time:    '${form.time}',
                  notes:   '${form.notes}',
                },
              },
            },
          ],
        }],
      },
    }],
  }
}

export const flowsService = {

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

    const { rows: services } = await pool.query(
      `SELECT id::text AS id, name FROM services
       WHERE salon_id = $1 AND is_active = true
       ORDER BY name ASC LIMIT $2`,
      [salonId, MAX_SERVICES]
    )
    if (services.length === 0) throw new AppError(400, 'Add at least one active service first', 'NO_SERVICES')

    let result: any
    try {
      result = await whatsappMetaApi.createFlow({
        wabaId:      config.waba_id,
        accessToken: config.access_token,
        name:        `salonox_booking_${Date.now()}`,
        flowJson:    buildBookingFlowJson(services),
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

    const bodyText = 'Tap below to request your appointment - pick a service, date and time and our team will confirm.'
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
    const svcId = UUID_RE.test(String(resp.service || '')) ? String(resp.service) : null

    let serviceName: string | null = null
    if (svcId) {
      const { rows } = await pool.query(`SELECT name FROM services WHERE id = $1 AND salon_id = $2`, [svcId, salonId])
      serviceName = rows[0]?.name ?? null
    }

    const when = [date, time].filter(Boolean).join(' ')
    const summary = `📋 Booking request - ${serviceName ?? 'service not specified'}${when ? `, ${when}` : ''}${notes ? ` · ${notes}` : ''}`

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
        notes:        `Preferred: ${when || 'not given'}${notes ? `\n${notes}` : ''}`,
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
