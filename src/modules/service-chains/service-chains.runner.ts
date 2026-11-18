// Service Chain runner: (1) the enrolment sweep that turns a paid starting service into a journey,
// (2) the due-message executor that sends each step, (3) delivery-status updates from the webhook.
// Called from the same 5-minute tick as the other WhatsApp automation jobs
// (whatsapp-automation.scheduler.ts).
import pool from '../../config/database'
import logger from '../../config/logger'
import { getSalonTimezone } from '../../config/salonTimezone'
import { dateLocale } from '../../config/currency'
import { zonedInstant } from '../attendance/staffAttendance.rules'
import { configRepository } from '../marketing/whatsapp/config/config.repository'
import { whatsappMetaApi } from '../marketing/whatsapp/shared/whatsapp.api'
import { buildTemplateSendComponents, templateHasMediaHeader } from '../marketing/whatsapp/shared/template-components'
import { inboxRepository } from '../marketing/whatsapp/inbox/inbox.repository'
import { formatPhone } from '../whatsapp-automation/whatsapp-automation.service'
import { maskPhone } from '../utils/mask.util'
import type { ChainVariableField } from './service-chains.types'

// Meta says this recipient/account cannot receive it - not a fault worth retrying.
const BLOCK_CODES = [131047, 131026, 131051, 131049, 131042]

// ── Date maths ────────────────────────────────────────────────────────────────
// Purchase date in the salon's own calendar + N days, at the chain's send time, as a real instant.
function stepInstant(purchasedAt: Date, dayOffset: number, sendTime: string, timeZone: string): Date {
  const localDate = purchasedAt.toLocaleDateString('en-CA', { timeZone })            // YYYY-MM-DD
  const [y, m, d] = localDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + dayOffset))
  const ymd = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
  return zonedInstant(ymd, String(sendTime).slice(0, 8), timeZone)
}

// ── 1. Enrolment sweep ────────────────────────────────────────────────────────
// A bill counts as "purchased" from its FIRST payment (partial or full). Keyed off payments.created_at -
// not appointments.updated_at - so a backdated or imported bill is still seen. Only purchases made after the
// chain was created enrol (creating a chain never floods recent clients), and package-covered lines
// (is_package_service) are not purchases.
async function findNewPurchases(limit = 300) {
  const { rows } = await pool.query(
    `SELECT ch.id AS chain_id, ch.salon_id, ch.send_time, ch.on_repeat, a.id AS appointment_id, a.client_id,
            COALESCE(NULLIF(item->>'id', ''), item->>'service_id') AS line_id,
            LEAST(a.scheduled_at, fp.first_paid) AS purchased_at, fp.first_paid
     FROM service_chains ch
     JOIN appointments a ON a.salon_id = ch.salon_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS item
     JOIN LATERAL (
       SELECT MIN(p.created_at) AS first_paid FROM payments p
       WHERE p.appointment_id = a.id AND p.status IN ('partial', 'completed')
     ) fp ON fp.first_paid IS NOT NULL
     WHERE ch.is_active AND ch.deleted_at IS NULL AND ch.starting_service_id IS NOT NULL
       AND item->>'service_id' = ch.starting_service_id::text
       AND COALESCE((item->>'is_package_service')::boolean, FALSE) = FALSE
       AND a.deleted_at IS NULL AND a.client_id IS NOT NULL
       AND fp.first_paid >= ch.created_at
       AND fp.first_paid > NOW() - INTERVAL '3 days'
       AND NOT EXISTS (
         SELECT 1 FROM service_chain_enrolments e
         WHERE e.chain_id = ch.id AND e.source_appointment_id = a.id
           AND e.source_line_id = COALESCE(NULLIF(item->>'id', ''), item->>'service_id'))
     ORDER BY fp.first_paid
     LIMIT $1`,
    [limit],
  )
  return rows
}

async function enrol(hit: any): Promise<void> {
  const tz = await getSalonTimezone(hit.salon_id)
  const purchasedAt = new Date(hit.purchased_at)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Already handled by an earlier sweep (or a racing one).
    const dup = await client.query(
      `SELECT 1 FROM service_chain_enrolments WHERE chain_id=$1 AND source_appointment_id=$2 AND source_line_id=$3`,
      [hit.chain_id, hit.appointment_id, hit.line_id])
    if (dup.rows.length) { await client.query('ROLLBACK'); return }

    const { rows: live } = await client.query(
      `SELECT id, purchased_at FROM service_chain_enrolments
       WHERE chain_id=$1 AND client_id=$2 AND status IN ('active','paused') FOR UPDATE`,
      [hit.chain_id, hit.client_id])
    const current = live[0]

    // An older bill turning up late must not restart a journey that began from a newer purchase; and a chain set to
    // "ignore until finished" lets the running journey play out instead of restarting it.
    if (current && (hit.on_repeat === 'ignore_until_finished' || new Date(current.purchased_at).getTime() >= purchasedAt.getTime())) {
      await client.query(
        `INSERT INTO service_chain_enrolments (salon_id, chain_id, client_id, source_appointment_id, source_line_id, purchased_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,'superseded') ON CONFLICT DO NOTHING`,
        [hit.salon_id, hit.chain_id, hit.client_id, hit.appointment_id, hit.line_id, purchasedAt])
      await client.query('COMMIT')
      return
    }

    // Restart: the old journey's unsent steps are cancelled before the new one is created.
    if (current) {
      await client.query(`UPDATE service_chain_enrolments SET status='replaced', updated_at=NOW() WHERE id=$1`, [current.id])
      await client.query(
        `UPDATE service_chain_messages SET status='CANCELLED', skip_reason='Journey restarted by a new purchase', updated_at=NOW()
         WHERE enrolment_id=$1 AND status='SCHEDULED'`, [current.id])
    }

    const { rows: created } = await client.query(
      `INSERT INTO service_chain_enrolments (salon_id, chain_id, client_id, source_appointment_id, source_line_id, purchased_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active') ON CONFLICT DO NOTHING RETURNING id`,
      [hit.salon_id, hit.chain_id, hit.client_id, hit.appointment_id, hit.line_id, purchasedAt])
    if (!created[0]) { await client.query('ROLLBACK'); return }

    const { rows: steps } = await client.query(
      `SELECT id, day_offset, delay_minutes, parent_step_id, is_sub FROM service_chain_steps WHERE chain_id=$1 ORDER BY step_order`, [hit.chain_id])
    const now = Date.now()
    const stepAt = new Map<string, Date>()
    for (const st of steps) {
      let at: Date
      let past: boolean
      if (!st.is_sub) {
        at = stepInstant(purchasedAt, st.day_offset, hit.send_time, tz)
        past = at.getTime() <= now
        stepAt.set(st.id, at)
      } else if (!st.parent_step_id) {
        // Starting service's sub-step (aftercare): timed from the first payment itself. If the sweep ran a little late the
        // moment may already be behind us: send on the next tick when the payment is still recent, otherwise it is too late.
        const paid = new Date(hit.first_paid).getTime()
        at = new Date(paid + st.delay_minutes * 60_000)
        past = false
        if (at.getTime() <= now) {
          if (now - paid <= 60 * 60_000) at = new Date(now)
          else past = true
        }
      } else {
        // A step's sub-step: its delay after the step's own send time.
        const parentAt = stepAt.get(st.parent_step_id)
        if (!parentAt) continue
        at = new Date(parentAt.getTime() + st.delay_minutes * 60_000)
        past = at.getTime() <= now
      }
      await client.query(
        `INSERT INTO service_chain_messages (salon_id, enrolment_id, step_id, scheduled_at, status, skip_reason)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [hit.salon_id, created[0].id, st.id, at, past ? 'SKIPPED' : 'SCHEDULED', past ? 'Date already passed' : null])
    }
    await client.query('COMMIT')
    await maybeCompleteEnrolment(created[0].id)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

async function runEnrolmentSweep(): Promise<number> {
  let n = 0
  const hits = await findNewPurchases()
  for (const hit of hits) {
    try { await enrol(hit); n++ } catch (err: any) {
      logger.error('[service-chain] enrol failed', { chainId: hit.chain_id, appointmentId: hit.appointment_id, error: err?.message })
    }
  }
  if (n) logger.info(`[service-chain] sweep enrolled ${n} purchase(s)`)
  return n
}

// An enrolment is done once none of its messages is still waiting.
async function maybeCompleteEnrolment(enrolmentId: string): Promise<void> {
  await pool.query(
    `UPDATE service_chain_enrolments e SET status='completed', updated_at=NOW()
     WHERE e.id = $1 AND e.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM service_chain_messages m WHERE m.enrolment_id = e.id AND m.status IN ('SCHEDULED','SENDING'))`,
    [enrolmentId])
}

// ── 2. Due-message executor ───────────────────────────────────────────────────
async function setOutcome(id: string, status: string, fields: { reason?: string; code?: string; message?: string; wamid?: string } = {}) {
  await pool.query(
    `UPDATE service_chain_messages
     SET status=$2, skip_reason=$3, error_code=$4, error_message=$5, wamid=COALESCE($6, wamid),
         sent_at = CASE WHEN $2 = 'SENT' THEN NOW() ELSE sent_at END, updated_at=NOW()
     WHERE id=$1`,
    [id, status, fields.reason ?? null, fields.code ?? null, fields.message ?? null, fields.wamid ?? null])
}

// Why a step's message should not be sent, or null to send it. All four rules look at the client's other bills for the
// step's service (never the bill that started the journey):
//   bought     paid for it since the journey began
//   completed  had it done (service marked completed, or a paid visit that already happened) since the journey began
//   upcoming   already has a future appointment for it
//   recent     bought it in the last N days (per-step setting), counting purchases before the journey too
// "bought" and "completed" are permanent facts, so `eagerOnly` (used to cancel future steps early) checks just those.
async function skipReason(row: any, eagerOnly = false): Promise<string | null> {
  if (!row.step_service_id) return null
  const wantBought = row.skip_if_bought !== false
  const wantCompleted = row.skip_if_completed !== false
  const wantUpcoming = !eagerOnly && row.skip_if_upcoming !== false
  const days: number | null = !eagerOnly && row.skip_if_bought_days ? Number(row.skip_if_bought_days) : null
  if (!wantBought && !wantCompleted && !wantUpcoming && days === null) return null

  const { rows } = await pool.query(
    `WITH m AS (
       SELECT a.id, a.status, a.scheduled_at, item->>'status' AS item_status
       FROM appointments a
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS item
       WHERE a.salon_id = $1 AND a.client_id = $2 AND a.deleted_at IS NULL AND a.id <> $3 AND item->>'service_id' = $4)
     SELECT
       EXISTS (SELECT 1 FROM m WHERE EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = m.id
                 AND p.status IN ('partial','completed') AND p.created_at > $5)) AS bought,
       EXISTS (SELECT 1 FROM m WHERE m.status NOT IN ('cancelled','no-show','deleted')
                 AND m.scheduled_at > $5 AND m.scheduled_at <= NOW() AND (m.item_status = 'completed' OR m.status = 'paid')) AS completed,
       EXISTS (SELECT 1 FROM m WHERE m.status IN ('booked','partial','paid') AND m.scheduled_at > NOW()) AS upcoming,
       ($6::int IS NOT NULL AND EXISTS (SELECT 1 FROM m WHERE EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = m.id
                 AND p.status IN ('partial','completed') AND p.created_at > NOW() - ($6::int * INTERVAL '1 day')))) AS recent`,
    [row.salon_id, row.client_id, row.source_appointment_id, String(row.step_service_id), row.purchased_at, days])
  const f = rows[0]
  if (wantBought && f.bought) return 'Client already bought this service'
  if (wantCompleted && f.completed) return 'Client already completed this service'
  if (wantUpcoming && f.upcoming) return 'Client already has an upcoming appointment for this service'
  if (days !== null && f.recent) return `Client bought this service in the last ${days} days`
  return null
}

// If the bill that started a journey is later cancelled, deleted or fully refunded (no paid payment left), the client never
// really bought the service: stop the journey and cancel what is still waiting. A partial refund that leaves a paid payment
// keeps it running.
async function cancelRefundedJourneys(): Promise<number> {
  const { rows } = await pool.query(
    `UPDATE service_chain_enrolments e SET status = 'cancelled', updated_at = NOW()
     FROM appointments a
     WHERE a.id = e.source_appointment_id AND e.status IN ('active', 'paused')
       AND (a.deleted_at IS NOT NULL OR a.status IN ('cancelled', 'deleted')
            OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('partial', 'completed')))
     RETURNING e.id`)
  if (!rows.length) return 0
  await pool.query(
    `UPDATE service_chain_messages SET status = 'CANCELLED', skip_reason = 'Bill was cancelled or refunded', updated_at = NOW()
     WHERE status = 'SCHEDULED' AND enrolment_id = ANY($1::uuid[])`, [rows.map((r) => r.id)])
  logger.info(`[service-chain] stopped ${rows.length} journey(s) whose bill was cancelled or refunded`)
  return rows.length
}

// Cancel future steps the client has already made pointless (bought / completed their service) right away, instead of
// waiting for the step to fall due, and close the journey once nothing is left to send.
async function evaluateEagerSkips(limit = 200): Promise<number> {
  const { rows } = await pool.query(
    `SELECT m.id, m.enrolment_id, m.step_id, m.salon_id, e.client_id, e.purchased_at, e.source_appointment_id,
            st.service_id AS step_service_id, ch.skip_if_bought, ch.skip_if_completed
     FROM service_chain_messages m
     JOIN service_chain_enrolments e ON e.id = m.enrolment_id AND e.status = 'active'
     JOIN service_chains ch ON ch.id = e.chain_id AND ch.is_active AND ch.deleted_at IS NULL
     JOIN service_chain_steps st ON st.id = m.step_id AND NOT st.is_sub AND st.service_id IS NOT NULL
     WHERE m.status = 'SCHEDULED' AND m.scheduled_at > NOW()
     ORDER BY m.scheduled_at LIMIT $1`, [limit])
  let n = 0
  for (const r of rows) {
    try {
      const why = await skipReason(r, true)
      if (!why) continue
      const { rowCount } = await pool.query(
        `UPDATE service_chain_messages SET status='SKIPPED', skip_reason=$2, updated_at=NOW() WHERE id=$1 AND status='SCHEDULED'`, [r.id, why])
      if (!rowCount) continue
      n++
      // Its sub-steps follow it: if the step is not sent, neither are they.
      await pool.query(
        `UPDATE service_chain_messages SET status='SKIPPED', skip_reason='The step before it was not sent', updated_at=NOW()
         WHERE enrolment_id=$1 AND status='SCHEDULED'
           AND step_id IN (SELECT id FROM service_chain_steps WHERE parent_step_id = $2)`, [r.enrolment_id, r.step_id])
      await maybeCompleteEnrolment(r.enrolment_id)
    } catch (err: any) {
      logger.error('[service-chain] eager skip failed', { messageId: r.id, error: err?.message })
    }
  }
  if (n) logger.info(`[service-chain] cancelled ${n} step(s) the client no longer needs`)
  return n
}

export function resolveVariables(map: Record<string, ChainVariableField>, row: any, tz: string): Record<string, string> {
  const lastVisit = new Date(row.purchased_at).toLocaleDateString(dateLocale(), { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' })
  const values: Record<ChainVariableField, string> = {
    client_name:      String(row.client_name || '').trim() || 'there',
    salon_name:       row.salon_name || 'our salon',
    starting_service: row.starting_service_name || '',
    step_service:     row.step_service_name || '',
    last_visit_date:  lastVisit,
  }
  const out: Record<string, string> = {}
  for (const [slot, field] of Object.entries(map ?? {})) out[slot] = values[field] || '-'
  return out
}

async function processOne(id: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT m.id, m.salon_id, m.enrolment_id,
            e.status AS enrolment_status, e.client_id, e.purchased_at, e.source_appointment_id,
            ch.is_active, ch.deleted_at, ch.skip_if_bought, ch.skip_if_completed, ch.skip_if_upcoming,
            st.service_id AS step_service_id, st.skip_if_bought_days, st.variable_map, st.parent_step_id, pm.status AS parent_status,
            COALESCE(ssv.name, psv.name) AS step_service_name, csv.name AS starting_service_name,
            t.id AS template_id, t.name AS template_name, t.language, t.status AS template_status,
            t.body_text, t.header_type, t.header_media_id, t.buttons,
            to_jsonb(t)->>'lto_text' AS lto_text, to_jsonb(t)->'carousel' AS carousel,
            c.phone_number, c.phone_country_code, c.whatsapp_marketing,
            COALESCE(NULLIF(c.full_name, ''), NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), '')) AS client_name,
            sal.business_name AS salon_name
     FROM service_chain_messages m
     JOIN service_chain_enrolments e ON e.id = m.enrolment_id
     JOIN service_chains ch ON ch.id = e.chain_id
     JOIN service_chain_steps st ON st.id = m.step_id
     JOIN clients c ON c.id = e.client_id
     JOIN salons sal ON sal.id = m.salon_id
     LEFT JOIN wa_templates t ON t.id = st.template_id
     LEFT JOIN services ssv ON ssv.id = st.service_id
     LEFT JOIN service_chain_steps pst ON pst.id = st.parent_step_id
     LEFT JOIN services psv ON psv.id = pst.service_id
     LEFT JOIN service_chain_messages pm ON pm.enrolment_id = m.enrolment_id AND pm.step_id = st.parent_step_id
     LEFT JOIN services csv ON csv.id = ch.starting_service_id
     WHERE m.id = $1`,
    [id])
  const row = rows[0]
  if (!row) return

  try {
    // A paused journey does not send, and what falls due meanwhile is skipped, never sent late after the resume.
    if (row.enrolment_status === 'paused') return await setOutcome(id, 'SKIPPED', { reason: 'Journey was paused' })
    if (row.enrolment_status !== 'active') return await setOutcome(id, 'CANCELLED', { reason: 'Journey is no longer active' })
    if (!row.is_active || row.deleted_at) return await setOutcome(id, 'CANCELLED', { reason: 'Chain is paused or deleted' })
    if (!String(row.phone_number ?? '').trim()) return await setOutcome(id, 'SKIPPED', { reason: 'Client has no phone number' })
    // Chain messages are marketing templates: an explicit opt-out always wins.
    if (row.whatsapp_marketing === false) return await setOutcome(id, 'SKIPPED', { reason: 'Client opted out of WhatsApp marketing' })
    // A sub-step follows its step: if that step never went out (skipped, failed, cancelled), neither does this.
    if (row.parent_step_id && !['SENT', 'DELIVERED', 'READ'].includes(row.parent_status)) {
      return await setOutcome(id, 'SKIPPED', { reason: 'The step before it was not sent' })
    }
    const why = await skipReason(row)
    if (why) return await setOutcome(id, 'SKIPPED', { reason: why })
    if (!row.template_id || row.template_status !== 'APPROVED') {
      return await setOutcome(id, 'FAILED', { reason: 'Template missing or not approved', message: 'Template is missing or no longer approved by Meta' })
    }
    const waConfig = await configRepository.findBySalonId(row.salon_id)
    if (!waConfig?.phone_number_id || !waConfig?.access_token) {
      return await setOutcome(id, 'FAILED', { reason: 'WhatsApp not connected', message: 'WhatsApp is not configured for this salon' })
    }
    if (templateHasMediaHeader(row) && !row.header_media_id) {
      return await setOutcome(id, 'FAILED', { code: 'MISSING_MEDIA_ID', message: 'Template has a media header but no media ID stored' })
    }

    const tz = await getSalonTimezone(row.salon_id)
    const variables = resolveVariables(row.variable_map, row, tz)
    const digits = formatPhone(String(row.phone_number), row.phone_country_code).replace(/\D/g, '')
    const to = `+${digits}`

    const result = await whatsappMetaApi.sendTemplateMessage({
      phoneNumberId: waConfig.phone_number_id,
      accessToken:   waConfig.access_token,
      to,
      templateName:  row.template_name,
      language:      row.language,
      components:    buildTemplateSendComponents(row, { variables, fallbackName: row.client_name, flowToken: `${row.salon_id}:chain:${row.enrolment_id}` }),
    })
    const wamid = result?.messages?.[0]?.id as string | undefined
    await setOutcome(id, 'SENT', { wamid })
    logger.info(`[service-chain] sent to ${maskPhone(to)} (wamid: ${wamid ?? 'none'})`, { messageId: id, salonId: row.salon_id })

    // Show it in the Inbox thread like any other outbound template. Best-effort.
    try {
      const body = String(row.body_text ?? '')
      const conversationId = await inboxRepository.upsertConversation(row.salon_id, to, row.client_name ?? null, body.slice(0, 80), false)
      await inboxRepository.insertMessage({ conversationId, salonId: row.salon_id, direction: 'OUTBOUND', body, wamid: wamid ?? null, status: 'SENT', mediaType: null, mediaUrl: null })
    } catch (inboxErr: any) {
      logger.warn('[service-chain] inbox write failed', { message: inboxErr?.message })
    }
  } catch (err: any) {
    const metaCode = Number(err?.response?.data?.error?.code)
    const message = err?.response?.data?.error?.message ?? err?.message ?? 'Send failed'
    logger.error('[service-chain] send failed', { messageId: id, metaCode, message })
    await setOutcome(id, 'FAILED', {
      code: Number.isFinite(metaCode) ? String(metaCode) : undefined,
      reason: BLOCK_CODES.includes(metaCode) ? 'Recipient or account cannot receive WhatsApp messages' : undefined,
      message,
    })
  } finally {
    await maybeCompleteEnrolment(row.enrolment_id).catch(() => undefined)
  }
}

async function runDueMessages(limit = 100): Promise<number> {
  // Rows left SENDING by a restart mid-send would otherwise be stuck forever.
  await pool.query(
    `UPDATE service_chain_messages SET status='FAILED', error_message='Send timed out - process may have restarted mid-send', updated_at=NOW()
     WHERE status='SENDING' AND updated_at < NOW() - INTERVAL '30 minutes'`)

  // Atomic claim - SKIP LOCKED so overlapping ticks never take the same row.
  const { rows } = await pool.query(
    `UPDATE service_chain_messages SET status='SENDING', updated_at=NOW()
     WHERE id IN (
       SELECT id FROM service_chain_messages
       WHERE status='SCHEDULED' AND scheduled_at <= NOW()
       ORDER BY scheduled_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id`,
    [limit])
  for (const r of rows) await processOne(r.id)
  return rows.length
}

export async function runServiceChainTick(): Promise<void> {
  await runEnrolmentSweep().catch((err) => logger.error('[service-chain] sweep error:', err?.message))
  await cancelRefundedJourneys().catch((err) => logger.error('[service-chain] refund check error:', err?.message))
  await evaluateEagerSkips().catch((err) => logger.error('[service-chain] eager skip error:', err?.message))
  await runDueMessages().catch((err) => logger.error('[service-chain] due error:', err?.message))
}

// ── 3. Delivery status (called from the WhatsApp webhook) ─────────────────────
// Returns true when the wamid belonged to a chain message, so the caller stops looking.
export async function applyChainDeliveryStatus(
  wamid: string, type: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED', error?: { code?: string | null; message?: string | null } | null,
): Promise<boolean> {
  // Never move a message backwards (a late SENT after READ).
  const rank = `CASE status WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 ELSE 0 END`
  const next = type === 'SENT' ? 1 : type === 'DELIVERED' ? 2 : type === 'READ' ? 3 : 0
  const { rowCount } = await pool.query(
    type === 'FAILED'
      ? `UPDATE service_chain_messages SET status='FAILED', error_code=$2, error_message=$3, updated_at=NOW() WHERE wamid=$1`
      : `UPDATE service_chain_messages SET status=$2, updated_at=NOW() WHERE wamid=$1 AND ${rank} < $3`,
    type === 'FAILED' ? [wamid, error?.code ?? null, error?.message ?? null] : [wamid, type, next])
  if (rowCount) return true
  const { rows } = await pool.query(`SELECT 1 FROM service_chain_messages WHERE wamid=$1 LIMIT 1`, [wamid])
  return rows.length > 0
}
