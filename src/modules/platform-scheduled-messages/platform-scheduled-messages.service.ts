import pool from '../../config/database'
import logger from '../../config/logger'
import { dateLocale } from '../../config/currency'
import { AppError } from '../../middleware/error.middleware'
import { configRepository } from '../marketing/whatsapp/config/config.repository'
import { getPlatformSalonId } from '../client-announcements/platform-salon'
import { whatsappAutomationRepository } from '../whatsapp-automation/whatsapp-automation.repository'
import { REMINDER_DAYS, ensureWhatsappTable } from '../subscriptions/subscription-expiry-reminder.service'
import { sendExpiryWhatsApp } from '../subscriptions/subscription-expiry-whatsapp'
import {
  ExpiryClaim, ExpirySubscription, ListFilters, PlatformScheduledMessage, ReminderAction, ReminderOverride, ScheduledStats,
  WhatsAppLogRow, WhatsAppState,
  UPCOMING_HORIZON_DAYS, addDays, buildMessages, computeStats, dayStartInstant, filterMessages, istDay, repeatReference,
  sweepInstant, whatsappReference,
} from './platform-scheduled-messages.rules'

export type ScheduledView = 'upcoming' | 'history'

export interface ListParams extends ListFilters {
  view: ScheduledView
  page: number
  limit: number
}

export interface ListResult {
  data: PlatformScheduledMessage[]
  total: number
  stats: ScheduledStats
}

/** History looks back this far unless a start date is given. */
const DEFAULT_HISTORY_DAYS = 60
const HISTORY_ROW_CAP = 5000

const CLAIMS = 'subscription_expiry_whatsapp_reminders'
const OVERRIDES = 'subscription_expiry_whatsapp_overrides'
const TOLERANCE = `INTERVAL '1 day'`   // see CLAIM_TOLERANCE_MS in the rules: an IST machine and the UTC server read period_end 5.5h apart

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>

// The claim table is created the first time the sweep runs, and the overrides table by a migration, so either may not exist yet:
// for reading that just means "nothing there".
async function queryIfTable<T = any>(sql: string, params: unknown[]): Promise<T[]> {
  try {
    const { rows } = await pool.query(sql, params)
    return rows
  } catch (err: any) {
    if (err?.code === '42P01') return []
    throw err
  }
}

const needsMigration = (err: any): never => {
  if (err?.code === '42P01') {
    throw new AppError(503, 'Skip, cancel and reschedule need a one-time database step first: run Migration/create_subscription_expiry_whatsapp_overrides.sql.', 'MIGRATION_REQUIRED')
  }
  throw err
}

async function inTransaction<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn((sql, params) => client.query(sql, params as any[]) as any)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

// ── Subscriptions ────────────────────────────────────────────────────────────

const ELIGIBLE_FROM = `
  FROM subscriptions s
  JOIN salons sa ON sa.id = s.salon_id
  LEFT JOIN users u ON u.id = sa.owner_id
  LEFT JOIN subscription_plans sp ON sp.id = s.plan_id`

// The sweep's own eligibility rules (subscription-expiry-reminder.service.ts), minus its "ends within 5 days" window.
const ELIGIBLE_WHERE = `
  s.status = 'active'
  AND COALESCE(s.is_trial, FALSE) = FALSE
  AND s.current_period_end IS NOT NULL
  AND (COALESCE(s.cancel_at_period_end, FALSE) = TRUE OR s.razorpay_subscription_id IS NULL)
  AND COALESCE(sa.is_active, TRUE) = TRUE
  AND NOT EXISTS (SELECT 1 FROM subscription_payments p
                  WHERE p.subscription_id = s.id AND p.payment_status = 'paid' AND p.billing_period_end > s.current_period_end)
  AND NOT EXISTS (SELECT 1 FROM subscriptions s2
                  WHERE s2.salon_id = s.salon_id AND s2.id <> s.id AND s2.status = 'active'
                    AND s2.current_period_end > s.current_period_end)`

const DAYS_LEFT = `((s.current_period_end AT TIME ZONE 'Asia/Kolkata')::date - (NOW() AT TIME ZONE 'Asia/Kolkata')::date)`

// subscriptions.current_period_end is a timestamp WITHOUT time zone. Two deliberate choices, both about that:
//  - The end DAY is worked out exactly as the 8 AM sweep does it ((col AT TIME ZONE 'Asia/Kolkata')::date), so this page shows
//    the day the sweep will really act on.
//  - The period end INSTANT is cast ::timestamptz in SQL (the session is UTC), so it never depends on which machine runs node:
//    node-postgres would otherwise read the bare timestamp in the server's own zone.
const selectPeople = (periodEndInstant: string, endDay: string) => `
  s.id::text AS subscription_id, ${periodEndInstant} AS current_period_end,
  to_char(${endDay}, 'YYYY-MM-DD') AS end_day,
  sp.name AS plan_name, sa.id::text AS salon_id, COALESCE(sa.business_name, sa.slug, 'Unnamed salon') AS salon_name,
  NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '') AS owner_name,
  u.phone AS owner_phone`
const SELECT_LIVE = selectPeople('s.current_period_end::timestamptz', `(s.current_period_end AT TIME ZONE 'Asia/Kolkata')::date`)

const toSubscription = (r: any): ExpirySubscription => ({
  subscriptionId: r.subscription_id,
  periodEnd: new Date(r.current_period_end),
  endDay: r.end_day,
  planName: r.plan_name ?? null,
  salonId: r.salon_id,
  salonName: r.salon_name,
  ownerName: r.owner_name ?? null,
  ownerPhone: r.owner_phone ?? null,
})

async function whatsappState(): Promise<WhatsAppState> {
  const platformSalonId = await getPlatformSalonId()
  if (!platformSalonId) return { configured: false, templateApproved: false }
  const cfg = await configRepository.findBySalonId(platformSalonId)
  const configured = !!(cfg?.phone_number_id && cfg?.access_token)
  const template = configured ? await whatsappAutomationRepository.findTemplate('subscription_expiring', platformSalonId) : null
  return { configured, templateApproved: !!template }
}

async function istToday(): Promise<string> {
  const { rows } = await pool.query(`SELECT to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS today`)
  return rows[0].today
}

// ── Reading: upcoming + history ──────────────────────────────────────────────

async function loadClaims(since: Date, subscriptionIds: string[]): Promise<ExpiryClaim[]> {
  const rows = await queryIfTable(
    // End day is not needed here: a sent reminder sits on the day it was sent (see sentExpiryMessage).
    `SELECT r.days_before, r.sent_at, ${selectPeople('r.period_end', 'NULL::date')}
     FROM ${CLAIMS} r
     JOIN subscriptions s ON s.id = r.subscription_id
     JOIN salons sa ON sa.id = s.salon_id
     LEFT JOIN users u ON u.id = sa.owner_id
     LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE r.sent_at >= $1 OR r.subscription_id = ANY($2::uuid[])
     ORDER BY r.sent_at DESC
     LIMIT ${HISTORY_ROW_CAP}`,
    [since, subscriptionIds],
  )
  return rows.map((r): ExpiryClaim => ({ ...toSubscription(r), daysBefore: Number(r.days_before), sentAt: new Date(r.sent_at) }))
}

async function loadOverrides(since: Date, subscriptionIds: string[]): Promise<ReminderOverride[]> {
  const rows = await queryIfTable(
    `SELECT o.days_before, o.action, o.scheduled_for, o.send_at, o.sent_at, o.note, ${selectPeople('o.period_end', 'NULL::date')}
     FROM ${OVERRIDES} o
     JOIN subscriptions s ON s.id = o.subscription_id
     JOIN salons sa ON sa.id = s.salon_id
     LEFT JOIN users u ON u.id = sa.owner_id
     LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE o.scheduled_for >= $1 OR o.subscription_id = ANY($2::uuid[]) OR (o.action = 'rescheduled' AND o.sent_at IS NULL)
     LIMIT ${HISTORY_ROW_CAP}`,
    [since, subscriptionIds],
  )
  return rows.map((r): ReminderOverride => ({
    ...toSubscription(r),
    daysBefore: Number(r.days_before),
    action: r.action as ReminderAction,
    scheduledFor: new Date(r.scheduled_for),
    sendAt: r.send_at ? new Date(r.send_at) : null,
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
    note: r.note ?? null,
  }))
}

/**
 * The sender's latest log row per reminder, keyed by the reminder's own reference. The sweep's send is logged under that
 * reference; a Resend or a rescheduled send is logged under `<reference>:resend:<time>`, and the newest of them wins.
 */
async function latestLogs(refs: string[]): Promise<Map<string, WhatsAppLogRow>> {
  const logs = new Map<string, WhatsAppLogRow>()
  if (!refs.length) return logs
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (c.ref) c.ref AS ref, l.status, l.failure_reason, l.sent_at
     FROM unnest($1::text[]) AS c(ref)
     JOIN wa_automation_logs l
       ON l.event_type = 'subscription_expiring' AND (l.reference_id = c.ref OR l.reference_id LIKE c.ref || ':resend:%')
     ORDER BY c.ref, l.created_at DESC`,
    [refs],
  )
  for (const r of rows) logs.set(r.ref, { status: r.status, failureReason: r.failure_reason ?? null, sentAt: r.sent_at ? new Date(r.sent_at) : null })
  return logs
}

async function loadAll(todayKey: string, since: Date) {
  // Same rules as the 8 AM sweep, just looking up to UPCOMING_HORIZON_DAYS ahead instead of 5.
  const { rows: subRows } = await pool.query(
    `SELECT ${SELECT_LIVE} ${ELIGIBLE_FROM} WHERE ${ELIGIBLE_WHERE} AND ${DAYS_LEFT} BETWEEN 0 AND $1 ORDER BY s.current_period_end`,
    [UPCOMING_HORIZON_DAYS],
  )
  const subs = subRows.map(toSubscription)
  const ids = subs.map((s) => s.subscriptionId)
  const [claims, overrides, wa] = await Promise.all([loadClaims(since, ids), loadOverrides(since, ids), whatsappState()])

  const refs = [
    ...claims.map((c) => whatsappReference(c.subscriptionId, c.periodEnd, c.daysBefore)),
    ...overrides.filter((o) => o.sentAt).map((o) => whatsappReference(o.subscriptionId, o.periodEnd, o.daysBefore)),
  ]
  const logs = await latestLogs(refs)
  return buildMessages({ subs, claims, overrides, logs, todayKey, reminderDays: REMINDER_DAYS, wa })
}

// ── Acting on one reminder ───────────────────────────────────────────────────

interface LiveSubscription { sub: ExpirySubscription; daysRemaining: number }

/** The subscription as the sweep would see it right now, or a clear refusal when it no longer needs a reminder. */
async function requireSubscription(subscriptionId: string): Promise<LiveSubscription> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_LIVE}, ${DAYS_LEFT} AS days_remaining ${ELIGIBLE_FROM}
     WHERE s.id = $1::uuid AND ${ELIGIBLE_WHERE} AND ${DAYS_LEFT} >= 0`,
    [subscriptionId],
  )
  if (!rows[0]) throw new AppError(404, 'This subscription no longer needs a reminder (it was renewed, cancelled or has ended). Refresh the list.', 'NOT_FOUND')
  return { sub: toSubscription(rows[0]), daysRemaining: Math.max(Number(rows[0].days_remaining), 0) }
}

const requireDay = (daysBefore: number): number => {
  if (!Number.isInteger(daysBefore) || !REMINDER_DAYS.includes(daysBefore)) throw new AppError(400, 'Unknown reminder.', 'VALIDATION_ERROR')
  return daysBefore
}

interface ReminderState {
  /** period_end of the claim row, when the sweep (or an admin) already dealt with this reminder. */
  claim: { periodEnd: Date; sentAt: Date } | null
  override: { periodEnd: Date; action: ReminderAction; scheduledFor: Date; sentAt: Date | null } | null
}

async function stateOf(sub: ExpirySubscription, daysBefore: number): Promise<ReminderState> {
  const params = [sub.subscriptionId, daysBefore, sub.periodEnd]
  const where = `subscription_id = $1::uuid AND days_before = $2 AND period_end BETWEEN $3::timestamptz - ${TOLERANCE} AND $3::timestamptz + ${TOLERANCE}`
  const [claims, overrides] = await Promise.all([
    queryIfTable(`SELECT period_end, sent_at FROM ${CLAIMS} WHERE ${where} LIMIT 1`, params),
    queryIfTable(`SELECT period_end, action, scheduled_for, sent_at FROM ${OVERRIDES} WHERE ${where} LIMIT 1`, params),
  ])
  return {
    claim: claims[0] ? { periodEnd: new Date(claims[0].period_end), sentAt: new Date(claims[0].sent_at) } : null,
    override: overrides[0]
      ? { periodEnd: new Date(overrides[0].period_end), action: overrides[0].action, scheduledFor: new Date(overrides[0].scheduled_for), sentAt: overrides[0].sent_at ? new Date(overrides[0].sent_at) : null }
      : null,
  }
}

const isPendingReschedule = (s: ReminderState) => s.override?.action === 'rescheduled' && !s.override.sentAt

const NOT_READY: Record<string, string> = {
  no_phone: 'The owner has no phone number.',
  platform_not_configured: "SalonOx's WhatsApp number is not connected (Super Meta > Configuration).",
  template_pending: 'The Subscription expiring template is not approved by Meta yet (Super Meta > Automated Messages).',
}

const expiryDateText = (d: Date) => d.toLocaleDateString(dateLocale(),{ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** Hands the reminder to the WhatsApp sender (the same path the sweep uses). Throws a readable error when it cannot go yet. */
async function deliver(live: LiveSubscription, reference: string): Promise<void> {
  const { sub } = live
  const out = await sendExpiryWhatsApp({
    ownerPhone: sub.ownerPhone,
    ownerName: sub.ownerName,
    salonName: sub.salonName,
    planName: sub.planName ?? 'SalonOx',
    expiryDate: expiryDateText(sub.periodEnd),
    daysRemaining: live.daysRemaining,
    referenceId: reference,
  })
  if (!out.sent) throw new AppError(409, NOT_READY[out.skipped] ?? 'The reminder cannot be sent right now.', 'WHATSAPP_NOT_READY')
}

const canonicalRef = (sub: ExpirySubscription, periodEnd: Date, daysBefore: number) => whatsappReference(sub.subscriptionId, periodEnd, daysBefore)

async function ensureClaimsTable(): Promise<void> {
  if (!(await ensureWhatsappTable())) throw new AppError(503, 'The reminder records are not available right now. Try again in a moment.', 'UNAVAILABLE')
}

async function lastSendFailed(sub: ExpirySubscription, periodEnd: Date, daysBefore: number): Promise<boolean> {
  const ref = whatsappReference(sub.subscriptionId, periodEnd, daysBefore)
  return (await latestLogs([ref])).get(ref)?.status.toUpperCase() === 'FAILED'
}

/** The claim and the override that record an admin's decision about one reminder, written together or not at all. */
async function writeDecision(q: Query, p: {
  sub: ExpirySubscription; daysBefore: number; periodEnd: Date; action: ReminderAction; scheduledFor: Date; sendAt: Date | null; note: string | null; adminId: string | null
}): Promise<void> {
  await q(`INSERT INTO ${CLAIMS} (subscription_id, period_end, days_before) VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING`,
    [p.sub.subscriptionId, p.periodEnd, p.daysBefore])
  await q(
    `INSERT INTO ${OVERRIDES} (subscription_id, period_end, days_before, action, scheduled_for, send_at, sent_at, note, created_by)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, NULL, $7, $8::uuid)
     ON CONFLICT (subscription_id, period_end, days_before)
     DO UPDATE SET action = EXCLUDED.action, scheduled_for = EXCLUDED.scheduled_for, send_at = EXCLUDED.send_at, sent_at = NULL,
                   note = EXCLUDED.note, created_by = EXCLUDED.created_by, updated_at = NOW()`,
    [p.sub.subscriptionId, p.periodEnd, p.daysBefore, p.action, p.scheduledFor, p.sendAt, p.note, p.adminId],
  )
}

const slotOf = (sub: ExpirySubscription, daysBefore: number) => new Date(sweepInstant(addDays(sub.endDay, -daysBefore)))

export const platformScheduledMessagesService = {
  async list(p: ListParams): Promise<ListResult> {
    const todayKey = await istToday()

    // History only reaches back as far as the list was asked to look.
    const since = new Date(dayStartInstant(p.dateFrom ?? addDays(todayKey, -DEFAULT_HISTORY_DAYS)))
    const { upcoming, history } = await loadAll(todayKey, since)

    // Stats ignore the filters, like Scheduled Templates' cards.
    const stats = computeStats(upcoming, history, todayKey)

    const filtered = filterMessages(p.view === 'upcoming' ? upcoming : history, p)
    const start = (p.page - 1) * p.limit
    return { data: filtered.slice(start, start + p.limit), total: filtered.length, stats }
  },

  /** Send the reminder now instead of at its 8 AM slot (or at its rescheduled time). */
  async sendNow(subscriptionId: string, daysBefore: number): Promise<{ message: string }> {
    requireDay(daysBefore)
    const live = await requireSubscription(subscriptionId)
    await ensureClaimsTable()
    const st = await stateOf(live.sub, daysBefore)

    if (st.override && !isPendingReschedule(st)) {
      throw new AppError(409, st.override.sentAt ? 'This reminder was already sent. Use Resend.' : `This reminder was ${st.override.action} by an admin.`, 'CONFLICT')
    }
    if (st.claim && !st.override) throw new AppError(409, 'This reminder was already handed to WhatsApp. Use Resend.', 'CONFLICT')

    if (st.override) {
      // A rescheduled reminder that is still waiting: mark it sent first (so the due-time check cannot send it too), undo on failure.
      const periodEnd = st.override.periodEnd
      const marked = await pool.query(
        `UPDATE ${OVERRIDES} SET sent_at = NOW(), updated_at = NOW()
         WHERE subscription_id = $1::uuid AND period_end = $2 AND days_before = $3 AND action = 'rescheduled' AND sent_at IS NULL RETURNING 1`,
        [subscriptionId, periodEnd, daysBefore],
      )
      if (!marked.rowCount) throw new AppError(409, 'This reminder was just sent.', 'CONFLICT')
      try {
        await deliver(live, repeatReference(canonicalRef(live.sub, periodEnd, daysBefore), Date.now()))
      } catch (err) {
        await pool.query(`UPDATE ${OVERRIDES} SET sent_at = NULL WHERE subscription_id = $1::uuid AND period_end = $2 AND days_before = $3`, [subscriptionId, periodEnd, daysBefore]).catch(() => undefined)
        throw err
      }
    } else {
      // A normal waiting reminder: claim it first, exactly like the sweep, so the sweep never sends it as well.
      const claim = await pool.query(
        `INSERT INTO ${CLAIMS} (subscription_id, period_end, days_before) VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING RETURNING subscription_id`,
        [subscriptionId, live.sub.periodEnd, daysBefore],
      )
      if (!claim.rowCount) throw new AppError(409, 'This reminder was just sent.', 'CONFLICT')
      try {
        await deliver(live, canonicalRef(live.sub, live.sub.periodEnd, daysBefore))
      } catch (err) {
        await pool.query(`DELETE FROM ${CLAIMS} WHERE subscription_id = $1::uuid AND period_end = $2 AND days_before = $3`, [subscriptionId, live.sub.periodEnd, daysBefore]).catch(() => undefined)
        throw err
      }
    }
    return { message: 'Sent to WhatsApp. Its delivery status will show in History.' }
  },

  /** Send a reminder that already went out (or failed) once more. */
  async resend(subscriptionId: string, daysBefore: number): Promise<{ message: string }> {
    requireDay(daysBefore)
    const live = await requireSubscription(subscriptionId)
    const st = await stateOf(live.sub, daysBefore)
    if (!st.claim) throw new AppError(409, 'This reminder has not been sent yet. Use Send Now.', 'CONFLICT')
    if (st.override && !(st.override.action === 'rescheduled' && st.override.sentAt)) {
      throw new AppError(409, 'This reminder was skipped, cancelled or is waiting for its rescheduled time.', 'CONFLICT')
    }
    const periodEnd = st.claim.periodEnd
    await deliver(live, repeatReference(canonicalRef(live.sub, periodEnd, daysBefore), Date.now()))
    return { message: 'Sent to WhatsApp again. Its delivery status will show in History.' }
  },

  /** Send this reminder at a time of the admin's choosing instead of its 8 AM slot. */
  async reschedule(subscriptionId: string, daysBefore: number, sendAt: Date, adminId: string | null): Promise<{ message: string }> {
    requireDay(daysBefore)
    if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() < Date.now() + 60_000) throw new AppError(400, 'Pick a time in the future.', 'VALIDATION_ERROR')
    const live = await requireSubscription(subscriptionId)
    if (sendAt.getTime() > live.sub.periodEnd.getTime()) throw new AppError(400, 'Pick a time before the subscription ends.', 'VALIDATION_ERROR')
    if (!live.sub.ownerPhone || !live.sub.ownerPhone.replace(/\D/g, '')) throw new AppError(409, 'The owner has no phone number.', 'CONFLICT')
    await ensureClaimsTable()
    const st = await stateOf(live.sub, daysBefore)

    // Already handed to WhatsApp and not rescheduled since: only a failed one may be sent again at a new time.
    const sentBefore = st.claim && (!st.override || (st.override.action === 'rescheduled' && st.override.sentAt))
    if (sentBefore && !(await lastSendFailed(live.sub, st.claim!.periodEnd, daysBefore))) {
      throw new AppError(409, 'This reminder was already sent.', 'CONFLICT')
    }

    const periodEnd = st.claim?.periodEnd ?? live.sub.periodEnd
    const scheduledFor = st.override && !st.override.sentAt ? st.override.scheduledFor
      : st.claim && !st.override ? new Date(sweepInstant(istDay(st.claim.sentAt)))
      : slotOf(live.sub, daysBefore)
    try {
      await inTransaction((q) => writeDecision(q, { sub: live.sub, daysBefore, periodEnd, action: 'rescheduled', scheduledFor, sendAt, note: null, adminId }))
    } catch (err) { needsMigration(err) }
    return { message: 'Rescheduled.' }
  },

  /** Do not send this one reminder. */
  async skip(subscriptionId: string, daysBefore: number, adminId: string | null): Promise<{ message: string }> {
    requireDay(daysBefore)
    const live = await requireSubscription(subscriptionId)
    await ensureClaimsTable()
    const st = await stateOf(live.sub, daysBefore)
    if (st.override && !isPendingReschedule(st)) throw new AppError(409, `This reminder was already ${st.override.action}.`, 'CONFLICT')
    if (st.claim && !st.override) throw new AppError(409, 'This reminder was already sent.', 'CONFLICT')

    const periodEnd = st.claim?.periodEnd ?? live.sub.periodEnd
    const scheduledFor = st.override?.scheduledFor ?? slotOf(live.sub, daysBefore)
    try {
      await inTransaction((q) => writeDecision(q, { sub: live.sub, daysBefore, periodEnd, action: 'skipped', scheduledFor, sendAt: null, note: null, adminId }))
    } catch (err) { needsMigration(err) }
    return { message: 'Skipped. This reminder will not be sent.' }
  },

  /** Do not send any of this subscription's remaining reminders. */
  async cancel(subscriptionId: string, daysBefore: number, adminId: string | null): Promise<{ message: string; cancelled: number }> {
    requireDay(daysBefore)
    const live = await requireSubscription(subscriptionId)
    await ensureClaimsTable()
    const today = await istToday()

    let cancelled = 0
    try {
      await inTransaction(async (q) => {
        for (const d of REMINDER_DAYS) {
          const stillAhead = addDays(live.sub.endDay, -d) >= today
          if (!stillAhead && d !== daysBefore) continue   // the reminder clicked on always counts, even a rescheduled one whose original day has passed
          const st = await stateOf(live.sub, d)
          if (st.override && !isPendingReschedule(st)) continue                        // already skipped / cancelled / rescheduled and sent
          if (st.claim && !st.override) continue                                       // already handed to WhatsApp
          const periodEnd = st.claim?.periodEnd ?? live.sub.periodEnd
          const scheduledFor = st.override?.scheduledFor ?? slotOf(live.sub, d)
          await writeDecision(q, { sub: live.sub, daysBefore: d, periodEnd, action: 'cancelled', scheduledFor, sendAt: null, note: null, adminId })
          cancelled++
        }
      })
    } catch (err) { needsMigration(err) }
    if (!cancelled) throw new AppError(409, 'Nothing left to cancel for this subscription.', 'CONFLICT')
    return { message: `Cancelled ${cancelled} reminder${cancelled === 1 ? '' : 's'} for this subscription.`, cancelled }
  },

  /**
   * Called every few minutes by the automation scheduler: sends the rescheduled reminders whose time has come. A reminder is
   * marked sent BEFORE it goes out (so two instances never both send it) and un-marked when it cannot go yet, to be tried again.
   */
  async runRescheduledTick(): Promise<number> {
    const due = await queryIfTable<{ subscription_id: string; period_end: Date; days_before: number; send_at: Date }>(
      `SELECT subscription_id::text AS subscription_id, period_end, days_before, send_at FROM ${OVERRIDES}
       WHERE action = 'rescheduled' AND sent_at IS NULL AND send_at <= NOW() ORDER BY send_at LIMIT 50`,
      [],
    )
    let sent = 0
    for (const r of due) {
      const key = [r.subscription_id, r.period_end, Number(r.days_before)]
      try {
        const marked = await pool.query(
          `UPDATE ${OVERRIDES} SET sent_at = NOW(), updated_at = NOW()
           WHERE subscription_id = $1::uuid AND period_end = $2 AND days_before = $3 AND action = 'rescheduled' AND sent_at IS NULL RETURNING 1`,
          key,
        )
        if (!marked.rowCount) continue   // another instance has it

        let live: LiveSubscription | null = null
        try { live = await requireSubscription(r.subscription_id) } catch { live = null }
        if (!live) {
          // Renewed / cancelled / ended while it waited: it no longer applies.
          await pool.query(
            `UPDATE ${OVERRIDES} SET action = 'cancelled', sent_at = NULL, send_at = NULL, note = $4, updated_at = NOW()
             WHERE subscription_id = $1::uuid AND period_end = $2 AND days_before = $3`,
            [...key, 'The subscription was renewed or has ended, so the reminder no longer applies.'],
          )
          continue
        }
        try {
          await deliver(live, repeatReference(canonicalRef(live.sub, new Date(r.period_end), Number(r.days_before)), new Date(r.send_at).getTime()))
          sent++
        } catch (err: any) {
          await pool.query(`UPDATE ${OVERRIDES} SET sent_at = NULL WHERE subscription_id = $1::uuid AND period_end = $2 AND days_before = $3`, key).catch(() => undefined)
          if (err?.code !== 'WHATSAPP_NOT_READY') logger.error('[PLATFORM-SCHEDULED] Rescheduled reminder failed', { subscriptionId: r.subscription_id, error: err?.message })
        }
      } catch (err: any) {
        logger.error('[PLATFORM-SCHEDULED] Rescheduled tick error', { subscriptionId: r.subscription_id, error: err?.message })
      }
    }
    return sent
  },
}
