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
import { templateNeedsExpiry } from '../marketing/whatsapp/shared/offer-components'
import { ensureTemplateMediaFresh, MediaRefreshError } from '../marketing/whatsapp/shared/template-media-refresh'
import { inboxRepository } from '../marketing/whatsapp/inbox/inbox.repository'
import { formatPhone } from '../whatsapp-automation/whatsapp-automation.service'
import { maskPhone } from '../utils/mask.util'
import type { ChainVariableField } from './service-chains.types'
import { BLOCK_CODES, chainOfferExpiryMs, decideEligibility, decidePostponed, isTemporaryFailure, nextRetryAt, type Eligibility, type PostponedState } from './service-chains.rules'

// Append-only audit trail: one row per state change of a step. Best effort - history must never break sending.
async function logEvent(messageId: string, event: string, toStatus: string | null, reason?: string | null, appointmentId?: string | null) {
  try {
    await pool.query(
      `INSERT INTO service_chain_message_events (salon_id, message_id, enrolment_id, event, from_status, to_status, reason, appointment_id)
       SELECT salon_id, id, enrolment_id, $2, status, $3, $4, $5 FROM service_chain_messages WHERE id = $1`,
      [messageId, event, toStatus, reason ?? null, appointmentId ?? null])
  } catch (err: any) {
    logger.warn('[service-chain] history write failed', { messageId, error: err?.message })
  }
}

// Cancel every unsent (waiting or postponed) message of these journeys and record why, in one place so the history stays complete.
async function cancelUnsent(enrolmentIds: string[], reason: string, db: { query: (sql: string, p?: any[]) => Promise<any> } = pool): Promise<void> {
  await db.query(
    `INSERT INTO service_chain_message_events (salon_id, message_id, enrolment_id, event, from_status, to_status, reason)
     SELECT salon_id, id, enrolment_id, 'cancelled', status, 'CANCELLED', $2 FROM service_chain_messages
     WHERE enrolment_id = ANY($1::uuid[]) AND status IN ('SCHEDULED', 'POSTPONED')`, [enrolmentIds, reason])
  await db.query(
    `UPDATE service_chain_messages SET status = 'CANCELLED', skip_reason = $2, updated_at = NOW()
     WHERE enrolment_id = ANY($1::uuid[]) AND status IN ('SCHEDULED', 'POSTPONED')`, [enrolmentIds, reason])
}

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
       SELECT MIN(p.created_at)::timestamptz AS first_paid FROM payments p
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
      await cancelUnsent([current.id], 'Journey restarted by a new purchase', client)
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
      const { rows: msg } = await client.query(
        `INSERT INTO service_chain_messages (salon_id, enrolment_id, step_id, scheduled_at, status, skip_reason)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
        [hit.salon_id, created[0].id, st.id, at, past ? 'SKIPPED' : 'SCHEDULED', past ? 'Date already passed' : null])
      if (msg[0]) {
        await client.query(
          `INSERT INTO service_chain_message_events (salon_id, message_id, enrolment_id, event, to_status, reason)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [hit.salon_id, msg[0].id, created[0].id, past ? 'skipped' : 'scheduled', past ? 'SKIPPED' : 'SCHEDULED', past ? 'Date already passed' : null])
      }
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
       AND NOT EXISTS (SELECT 1 FROM service_chain_messages m WHERE m.enrolment_id = e.id AND m.status IN ('SCHEDULED','POSTPONED','SENDING'))`,
    [enrolmentId])
}

// ── 2. Due-message executor ───────────────────────────────────────────────────
async function setOutcome(id: string, status: string, fields: { reason?: string; code?: string; message?: string; wamid?: string; appointmentId?: string | null; attempts?: number } = {}) {
  await logEvent(id, status.toLowerCase(), status, fields.reason ?? fields.message ?? null, fields.appointmentId ?? null)
  await pool.query(
    `UPDATE service_chain_messages
     SET status=$2, skip_reason=$3, error_code=$4, error_message=$5, wamid=COALESCE($6, wamid),
         postponed_appointment_id = CASE WHEN $2 = 'POSTPONED' THEN $7::uuid ELSE postponed_appointment_id END,
         recheck_at = CASE WHEN $2 = 'POSTPONED' THEN NULL ELSE recheck_at END,
         attempt_count = COALESCE($8::int, attempt_count),
         sent_at = CASE WHEN $2 = 'SENT' THEN NOW() ELSE sent_at END, updated_at=NOW()
     WHERE id=$1`,
    [id, status, fields.reason ?? null, fields.code ?? null, fields.message ?? null, fields.wamid ?? null, fields.appointmentId ?? null, fields.attempts ?? null])
}

// What to do with a step's message right now, from the client's other bills for the step's service (never the bill that
// started the journey). Facts are read fresh from the database on every call; the decision itself is in service-chains.rules.ts.
//   bought     paid for it since the journey began                                   -> skip
//   completed  had it done (service marked completed, or a paid visit that happened) -> skip
//   recent     bought it in the last N days (per-step setting), incl. before joining -> skip
//   upcoming   already has a future appointment for it                               -> postpone (wait for it)
// "bought" and "completed" are permanent facts, so `eagerOnly` (used to cancel future steps early) checks just those.
async function checkEligibility(row: any, eagerOnly = false): Promise<Eligibility> {
  if (!row.step_service_id) return { kind: 'send' }
  const wantBought = row.skip_if_bought !== false
  const wantCompleted = row.skip_if_completed !== false
  const wantUpcoming = !eagerOnly && row.skip_if_upcoming !== false
  const days: number | null = !eagerOnly && row.skip_if_bought_days ? Number(row.skip_if_bought_days) : null
  if (!wantBought && !wantCompleted && !wantUpcoming && days === null) return { kind: 'send' }

  const { rows } = await pool.query(
    `WITH m AS (
       SELECT a.id, a.status, a.scheduled_at, item->>'status' AS item_status
       FROM appointments a
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS item
       WHERE a.salon_id = $1 AND a.client_id = $2 AND a.deleted_at IS NULL AND a.id <> $3 AND item->>'service_id' = $4)
     SELECT
       EXISTS (SELECT 1 FROM m WHERE EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = m.id
                 AND p.status IN ('partial','completed') AND p.created_at > $5::timestamptz)) AS bought,
       EXISTS (SELECT 1 FROM m WHERE m.status NOT IN ('cancelled','no-show','deleted')
                 AND m.scheduled_at > $5 AND m.scheduled_at <= NOW() AND (m.item_status = 'completed' OR m.status = 'paid')) AS completed,
       (SELECT m.id FROM m WHERE m.status IN ('booked','partial','paid') AND m.scheduled_at > NOW() ORDER BY m.scheduled_at LIMIT 1) AS upcoming_id,
       ($6::int IS NOT NULL AND EXISTS (SELECT 1 FROM m WHERE EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = m.id
                 AND p.status IN ('partial','completed') AND p.created_at > NOW() - ($6::int * INTERVAL '1 day')))) AS recent`,
    [row.salon_id, row.client_id, row.source_appointment_id, String(row.step_service_id), row.purchased_at, days])
  const f = rows[0]
  return decideEligibility(
    { bought: f.bought, completed: f.completed, upcoming: !!f.upcoming_id, upcomingAppointmentId: f.upcoming_id, recent: f.recent },
    { wantBought, wantCompleted, wantUpcoming, recentDays: days })
}

// Skip a step for good, and its sub-steps with it, then close the journey if nothing is left.
async function skipStep(r: { id: string; enrolment_id: string; step_id: string }, reason: string): Promise<boolean> {
  await logEvent(r.id, 'skipped', 'SKIPPED', reason)
  const { rowCount } = await pool.query(
    `UPDATE service_chain_messages SET status='SKIPPED', skip_reason=$2, updated_at=NOW() WHERE id=$1 AND status IN ('SCHEDULED','POSTPONED')`, [r.id, reason])
  if (!rowCount) return false
  await pool.query(
    `UPDATE service_chain_messages SET status='SKIPPED', skip_reason='The step before it was not sent', updated_at=NOW()
     WHERE enrolment_id=$1 AND status IN ('SCHEDULED','POSTPONED')
       AND step_id IN (SELECT id FROM service_chain_steps WHERE parent_step_id = $2)`, [r.enrolment_id, r.step_id])
  await maybeCompleteEnrolment(r.enrolment_id)
  return true
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
  await cancelUnsent(rows.map((r) => r.id), 'Bill was cancelled or refunded')
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
      const d = await checkEligibility(r, true)
      if (d.kind !== 'skip') continue
      if (await skipStep(r, d.reason)) n++
    } catch (err: any) {
      logger.error('[service-chain] eager skip failed', { messageId: r.id, error: err?.message })
    }
  }
  if (n) logger.info(`[service-chain] cancelled ${n} step(s) the client no longer needs`)
  return n
}

// Postponed steps wait on one appointment. Every tick the appointment is read live (so a reschedule is followed
// automatically) and the step is skipped, kept waiting, given a 24-hour recheck, or released to the normal sender.
async function evaluatePostponed(limit = 200): Promise<number> {
  const { rows } = await pool.query(
    `SELECT m.id, m.enrolment_id, m.step_id, m.salon_id, m.postponed_appointment_id, m.recheck_at,
            e.client_id, e.purchased_at, e.source_appointment_id,
            st.service_id AS step_service_id, ch.skip_if_bought, ch.skip_if_completed, ch.skip_if_upcoming, st.skip_if_bought_days
     FROM service_chain_messages m
     JOIN service_chain_enrolments e ON e.id = m.enrolment_id AND e.status = 'active'
     JOIN service_chains ch ON ch.id = e.chain_id AND ch.is_active AND ch.deleted_at IS NULL
     JOIN service_chain_steps st ON st.id = m.step_id AND st.service_id IS NOT NULL
     WHERE m.status = 'POSTPONED'
     ORDER BY m.updated_at LIMIT $1`, [limit])
  let n = 0
  for (const r of rows) {
    try {
      let appointment: PostponedState = 'missing'
      if (r.postponed_appointment_id) {
        const { rows: ap } = await pool.query(
          `SELECT a.status, a.scheduled_at, a.deleted_at,
                  (SELECT bool_or(item->>'status' = 'completed') FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) item
                   WHERE item->>'service_id' = $2) AS item_done
           FROM appointments a WHERE a.id = $1`, [r.postponed_appointment_id, String(r.step_service_id)])
        const a = ap[0]
        const live = a && !a.deleted_at && !['cancelled', 'no-show', 'deleted'].includes(a.status)
        if (live) {
          const past = new Date(a.scheduled_at).getTime() <= Date.now()
          if (a.item_done || (a.status === 'paid' && past)) appointment = 'completed'
          else if (!past) appointment = 'upcoming'
          else appointment = 'cancelled'          // overdue and never done: treat like a cancellation and look again tomorrow
        } else appointment = 'cancelled'
      }

      // Bought / completed by some other bill meanwhile (a paid upcoming appointment counts as bought).
      const other = await checkEligibility(r, true)
      let action = decidePostponed(
        { appointment, boughtOrCompletedElsewhere: other.kind === 'skip', recheckAt: r.recheck_at ? new Date(r.recheck_at) : null }, new Date())

      // The tracked appointment is gone but the client booked another one: follow that one instead of waiting a day.
      if (appointment === 'cancelled' && action.kind !== 'skip') {
        const next = await checkEligibility(r, false)
        if (next.kind === 'postpone' && next.appointmentId && next.appointmentId !== r.postponed_appointment_id) {
          await logEvent(r.id, 'postponed', 'POSTPONED', 'Client booked another appointment for this service', next.appointmentId)
          await pool.query(`UPDATE service_chain_messages SET postponed_appointment_id=$2, recheck_at=NULL, skip_reason=$3, updated_at=NOW() WHERE id=$1`,
            [r.id, next.appointmentId, next.reason])
          continue
        }
      }

      if (action.kind === 'skip') {
        if (await skipStep(r, action.reason)) n++
      } else if (action.kind === 'wait24h') {
        await logEvent(r.id, 'recheck_scheduled', 'POSTPONED', action.reason, r.postponed_appointment_id)
        await pool.query(`UPDATE service_chain_messages SET recheck_at=$2, skip_reason=$3, updated_at=NOW() WHERE id=$1 AND status='POSTPONED'`, [r.id, action.recheckAt, action.reason])
      } else if (action.kind === 'release') {
        await logEvent(r.id, 'recheck', 'SCHEDULED', 'Rechecking eligibility after the 24-hour wait', r.postponed_appointment_id)
        await pool.query(`UPDATE service_chain_messages SET status='SCHEDULED', scheduled_at=NOW(), recheck_at=NULL, skip_reason=NULL, updated_at=NOW() WHERE id=$1 AND status='POSTPONED'`, [r.id])
      }
    } catch (err: any) {
      logger.error('[service-chain] postponed check failed', { messageId: r.id, error: err?.message })
    }
  }
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
    `SELECT m.id, m.salon_id, m.enrolment_id, m.attempt_count,
            e.status AS enrolment_status, e.client_id, e.purchased_at, e.source_appointment_id,
            ch.is_active, ch.deleted_at, ch.skip_if_bought, ch.skip_if_completed, ch.skip_if_upcoming,
            st.service_id AS step_service_id, st.skip_if_bought_days, st.variable_map, st.parent_step_id, pm.status AS parent_status,
            COALESCE(ssv.name, psv.name) AS step_service_name, csv.name AS starting_service_name,
            t.id AS template_id, t.name AS template_name, t.language, t.status AS template_status,
            t.body_text, t.header_type, t.header_media_id, t.buttons, t.meta_template_id,
            to_jsonb(t)->>'lto_text' AS lto_text, to_jsonb(t)->'carousel' AS carousel,
            c.phone_number, c.phone_country_code,
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
  let accepted = false      // Meta took the message: from here a failure must never trigger a second send

  try {
    // A paused journey does not send, and what falls due meanwhile is skipped, never sent late after the resume.
    if (row.enrolment_status === 'paused') return await setOutcome(id, 'SKIPPED', { reason: 'Journey was paused' })
    if (row.enrolment_status !== 'active') return await setOutcome(id, 'CANCELLED', { reason: 'Journey is no longer active' })
    if (!row.is_active || row.deleted_at) return await setOutcome(id, 'CANCELLED', { reason: 'Chain is paused or deleted' })
    if (!String(row.phone_number ?? '').trim()) return await setOutcome(id, 'SKIPPED', { reason: 'Client has no phone number' })
    // A sub-step follows its step. While that step is still waiting (scheduled, postponed or being sent) the sub-step waits
    // too; if the step never went out (skipped, failed, cancelled), neither does this.
    if (row.parent_step_id && ['SCHEDULED', 'POSTPONED', 'SENDING'].includes(row.parent_status)) {
      await pool.query(`UPDATE service_chain_messages SET status='SCHEDULED', scheduled_at=NOW() + INTERVAL '15 minutes', updated_at=NOW() WHERE id=$1`, [id])
      return
    }
    if (row.parent_step_id && !['SENT', 'DELIVERED', 'READ'].includes(row.parent_status)) {
      return await setOutcome(id, 'SKIPPED', { reason: 'The step before it was not sent' })
    }
    // Always a fresh look at the client's records, never the result from when the journey was created.
    const verdict = await checkEligibility(row)
    if (verdict.kind === 'skip') return await setOutcome(id, 'SKIPPED', { reason: verdict.reason })
    if (verdict.kind === 'postpone') return await setOutcome(id, 'POSTPONED', { reason: verdict.reason, appointmentId: verdict.appointmentId })
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

    // An image (or carousel card) Meta has forgotten - it keeps an upload only ~30 days - is rebuilt from the template's sample
    // before sending, instead of every message of that template failing.
    if (templateHasMediaHeader(row) || (Array.isArray(row.carousel) && row.carousel.length > 0)) {
      try {
        const fresh = await ensureTemplateMediaFresh(
          { id: row.template_id, salon_id: row.salon_id, meta_template_id: row.meta_template_id, header_type: row.header_type, header_media_id: row.header_media_id, carousel: row.carousel },
          { phone_number_id: waConfig.phone_number_id, access_token: waConfig.access_token })
        row.header_media_id = fresh.header_media_id
        row.carousel = fresh.carousel
      } catch (mediaErr: any) {
        if (mediaErr instanceof MediaRefreshError) return await setOutcome(id, 'FAILED', { code: 'MEDIA_EXPIRED', message: mediaErr.message })
        throw mediaErr   // a Meta / network problem: handled below like any other send failure (temporary ones are retried)
      }
    }

    const tz = await getSalonTimezone(row.salon_id)
    const variables = resolveVariables(row.variable_map, row, tz)
    // A limited-time-offer template needs the moment the offer ends; a chain step has no setting for it (see chainOfferExpiryMs).
    if (templateNeedsExpiry(row)) variables.offer_expires_at = String(chainOfferExpiryMs(Date.now()))
    const digits = formatPhone(String(row.phone_number), row.phone_country_code).replace(/\D/g, '')
    const to = `+${digits}`

    // Re-validate the journey immediately before the Meta call, holding a share lock on it for the call's duration: a restart
    // (which takes the row FOR UPDATE) either committed first, so nothing is sent, or waits until this send is done.
    let result: any
    const lock = await pool.connect()
    try {
      await lock.query('BEGIN')
      const { rows: live } = await lock.query(
        `SELECT e.status FROM service_chain_enrolments e JOIN service_chains ch ON ch.id = e.chain_id
         WHERE e.id = $1 AND ch.is_active AND ch.deleted_at IS NULL FOR SHARE OF e`, [row.enrolment_id])
      if (live[0]?.status !== 'active') {
        await lock.query('ROLLBACK')
        return await setOutcome(id, 'CANCELLED', { reason: 'Journey is no longer active' })
      }
      result = await whatsappMetaApi.sendTemplateMessage({
        phoneNumberId: waConfig.phone_number_id,
        accessToken:   waConfig.access_token,
        to,
        templateName:  row.template_name,
        language:      row.language,
        components:    buildTemplateSendComponents(row, { variables, fallbackName: row.client_name, flowToken: `${row.salon_id}:chain:${row.enrolment_id}` }),
      })
      accepted = true
      await lock.query('COMMIT')
    } catch (sendErr) {
      await lock.query('ROLLBACK').catch(() => undefined)
      throw sendErr
    } finally {
      lock.release()
    }
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
    logger.error('[service-chain] send failed', { messageId: id, metaCode, message, accepted })
    if (accepted) {
      // Meta already has the message; only our bookkeeping failed. Never retry (that would send it twice).
      await pool.query(`UPDATE service_chain_messages SET status='SENT', sent_at=COALESCE(sent_at, NOW()), updated_at=NOW() WHERE id=$1 AND status='SENDING'`, [id]).catch(() => undefined)
      return
    }
    const attempt = Number(row.attempt_count ?? 0) + 1
    const retryAt = isTemporaryFailure({
      metaCode: Number.isFinite(metaCode) ? metaCode : null,
      httpStatus: err?.response?.status ?? null,
      networkCode: err?.code ?? null,
    }) ? nextRetryAt(attempt, new Date()) : null
    const code = Number.isFinite(metaCode) ? String(metaCode) : undefined
    if (retryAt) {
      // A temporary problem (rate limit, Meta/server/network trouble): try again later. The row goes back to SCHEDULED, so
      // every eligibility check runs again before the next attempt, and the claim lock still allows only one sender.
      await logEvent(id, 'retry_scheduled', 'SCHEDULED', `Temporary failure (attempt ${attempt}): ${message}`)
      await pool.query(
        `UPDATE service_chain_messages SET status='SCHEDULED', scheduled_at=$2, next_retry_at=$2, attempt_count=$3,
                error_code=$4, error_message=$5, updated_at=NOW() WHERE id=$1`,
        [id, retryAt, attempt, code ?? null, message])
    } else {
      await setOutcome(id, 'FAILED', {
        code,
        reason: BLOCK_CODES.includes(metaCode) ? 'Recipient or account cannot receive WhatsApp messages' : undefined,
        message,
        attempts: attempt,
      })
    }
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
  await evaluatePostponed().catch((err) => logger.error('[service-chain] postponed check error:', err?.message))
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
