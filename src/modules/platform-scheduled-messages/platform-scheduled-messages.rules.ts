// Pure rules for Super Admin > Super Meta > Scheduled Messages: SalonOx's own WhatsApp reminders to salon owners whose
// subscription is about to end.
//
// Unlike a salon's Scheduled Templates, these are not stored as "scheduled" rows. The daily 8 AM IST sweep decides on the fly who
// gets one (see subscription-expiry-reminder.service.ts) and only remembers what it already handed over (a "claim"). So this page
// works the schedule OUT from the same rules (upcoming) and reads what was remembered (history).
//
// An admin's Skip / Cancel / Reschedule is remembered as an OVERRIDE, written together with a claim: the claim is what stops the
// sweep from sending that reminder on its own, the override says why (and, for a reschedule, when to send instead). So a claim
// WITH an override is never "sent" in History, it is whatever the override says.
//
// No database and no clock of its own here (callers pass the facts), so every rule is unit-testable. Days are 'YYYY-MM-DD'
// strings in IST, calculated with plain calendar arithmetic, so the host's time zone can never shift one.

/** The sweep runs at 8 AM IST. */
export const SEND_HOUR_IST = 8
/** How far ahead the list looks for subscriptions that will need a reminder. */
export const UPCOMING_HORIZON_DAYS = 30

export type PlatformMessageStatus = 'SCHEDULED' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'CANCELLED'
export const PLATFORM_MESSAGE_STATUSES: PlatformMessageStatus[] = ['SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED']

export interface PlatformScheduledMessage {
  id: string
  subscription_id: string
  status: PlatformMessageStatus
  /** ISO instant it goes out (or went out): 8 AM IST on the reminder day, or the time an admin rescheduled it to. */
  scheduled_at: string
  sent_at: string | null
  salon_id: string
  salon_name: string
  owner_name: string | null
  /** The owner's phone number. */
  recipient: string | null
  plan_name: string | null
  /** ISO instant the subscription ends. */
  period_end: string
  /** 0 = the expiry day itself. */
  days_before: number
  message_preview: string
  /** Why it will not go, or how it went. */
  note: string | null
}

// ── Calendar helpers ─────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' plus `n` days. */
export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** The instant the 8 AM IST sweep runs on `dayKey`. */
export function sweepInstant(dayKey: string): string {
  return new Date(`${dayKey}T${String(SEND_HOUR_IST).padStart(2, '0')}:00:00+05:30`).toISOString()
}

/** The instant an IST day begins. */
export function dayStartInstant(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00+05:30`).toISOString()
}

/** The IST calendar day an instant falls on. */
export function istDay(iso: string | Date): string {
  const ms = (iso instanceof Date ? iso : new Date(iso)).getTime()
  return new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2026-12-01' -> '1 Dec 2026' */
export function dayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

const whenText = (daysBefore: number) => (daysBefore <= 0 ? 'today' : daysBefore === 1 ? 'in 1 day' : `in ${daysBefore} days`)

export function expiryPreview(salonName: string, planName: string | null, endDay: string, daysBefore: number): string {
  return `${salonName}: ${planName ?? 'SalonOx'} plan expires ${whenText(daysBefore)} (${dayLabel(endDay)})`
}

// ── Subscriptions, claims, overrides ─────────────────────────────────────────

export interface ExpirySubscription {
  subscriptionId: string
  periodEnd: Date
  /** IST calendar day the period ends on, worked out the way the sweep does it. */
  endDay: string
  planName: string | null
  salonId: string
  salonName: string
  ownerName: string | null
  ownerPhone: string | null
}

/** What decides whether a WhatsApp reminder can actually go out right now (same checks as subscription-expiry-whatsapp.ts). */
export interface WhatsAppState {
  /** SalonOx's own Meta number is connected. */
  configured: boolean
  /** The "subscription_expiring" template is approved. */
  templateApproved: boolean
}

/** A reminder the sweep (or an admin) already handed over / dealt with: one row of the WhatsApp claim table. */
export interface ExpiryClaim extends ExpirySubscription {
  daysBefore: number
  sentAt: Date
}

export type ReminderAction = 'skipped' | 'cancelled' | 'rescheduled'

/** What an admin did to one reminder. Always written together with a claim (see the file header). */
export interface ReminderOverride extends ExpirySubscription {
  daysBefore: number
  action: ReminderAction
  /** The slot the sweep would have used, kept so the row stays on its day. */
  scheduledFor: Date
  /** Rescheduled only: when to send instead. */
  sendAt: Date | null
  /** Rescheduled only: when that send went out (null while it is still waiting). */
  sentAt: Date | null
  note: string | null
}

/** The WhatsApp sender's own log row for a reminder: what Meta actually did with it. */
export interface WhatsAppLogRow {
  status: string
  failureReason: string | null
  sentAt: Date | null
}

// The sweep's claim table keys a reminder on subscription + exact period end + days before. The period end it stamps comes from
// subscriptions.current_period_end, a timestamp WITHOUT time zone that node-postgres reads in the SERVER's own zone, so the same
// row can give different instants on an IST machine and a UTC one. Matching on the exact instant would then miss a claim another
// machine wrote, so a claim counts when it is for the same subscription and day-count and its period end is within a day.
const CLAIM_TOLERANCE_MS = 24 * 3600_000

/** `subscription|daysBefore` -> the period end (ms) of each claim made for it. */
export type ClaimIndex = Map<string, number[]>

export function addClaim(index: ClaimIndex, subscriptionId: string, daysBefore: number, periodEnd: Date): void {
  const key = `${subscriptionId}|${daysBefore}`
  const list = index.get(key)
  if (list) list.push(periodEnd.getTime()); else index.set(key, [periodEnd.getTime()])
}

export function isClaimed(index: ClaimIndex, subscriptionId: string, daysBefore: number, periodEnd: Date): boolean {
  return (index.get(`${subscriptionId}|${daysBefore}`) ?? []).some((ms) => Math.abs(ms - periodEnd.getTime()) < CLAIM_TOLERANCE_MS)
}

/** The reference id the WhatsApp sender stamps on its log row for the sweep's own send (subscription-expiry-reminder.service.ts). */
export const whatsappReference = (subscriptionId: string, periodEnd: Date, daysBefore: number): string =>
  `${subscriptionId}:${periodEnd.toISOString()}:${daysBefore}`

/** Any later send of the same reminder (Resend, a rescheduled send) needs a reference of its own or the sender's duplicate guard drops it. */
export const repeatReference = (canonical: string, atMs: number): string => `${canonical}:resend:${atMs}`

function base(s: ExpirySubscription, daysBefore: number) {
  return {
    id: `sub:${s.subscriptionId}:${s.periodEnd.getTime()}:${daysBefore}`,
    subscription_id: s.subscriptionId,
    scheduled_at: sweepInstant(addDays(s.endDay, -daysBefore)),
    salon_id: s.salonId,
    salon_name: s.salonName,
    owner_name: s.ownerName,
    recipient: s.ownerPhone,
    plan_name: s.planName,
    period_end: s.periodEnd.toISOString(),
    days_before: daysBefore,
    message_preview: expiryPreview(s.salonName, s.planName, s.endDay, daysBefore),
  }
}

/** Why a waiting reminder cannot go out right now, or null when nothing is in its way. */
export function whatsappBlocker(ownerPhone: string | null, wa: WhatsAppState): { status: PlatformMessageStatus; note: string } | null {
  if (!ownerPhone || !ownerPhone.replace(/\D/g, '')) return { status: 'SKIPPED', note: 'The owner has no phone number.' }
  if (!wa.configured) return { status: 'SCHEDULED', note: "Won't send until SalonOx's WhatsApp number is connected (Super Meta > Configuration)." }
  if (!wa.templateApproved) return { status: 'SCHEDULED', note: 'Waiting for the Subscription expiring template to be approved by Meta (Super Meta > Automated Messages).' }
  return null
}

/**
 * Every WhatsApp reminder still to come for the given subscriptions: one per reminder day from today onwards, leaving out the
 * ones already handed over or dealt with (`claimed`, which includes everything an admin skipped, cancelled or rescheduled).
 */
export function upcomingExpiryMessages(
  subs: ExpirySubscription[], todayKey: string, reminderDays: number[], claimed: ClaimIndex, wa: WhatsAppState,
): PlatformScheduledMessage[] {
  const out: PlatformScheduledMessage[] = []
  for (const s of subs) {
    for (const d of reminderDays) {
      if (addDays(s.endDay, -d) < todayKey) continue   // that day is behind us (the sweep only ever fires on the exact day)
      if (isClaimed(claimed, s.subscriptionId, d, s.periodEnd)) continue
      const blocker = whatsappBlocker(s.ownerPhone, wa)
      out.push({ ...base(s, d), status: blocker?.status ?? 'SCHEDULED', sent_at: null, note: blocker?.note ?? null })
    }
  }
  return out
}

/** What the sender's log says happened to a reminder handed over at `sentAt`. */
function outcome(log: WhatsAppLogRow | null, sentAt: Date): { status: PlatformMessageStatus; sent_at: string; note: string | null } {
  // The sweep only hands the message over; whether Meta took it is in the sender's own log.
  if (!log) return { status: 'SENT', sent_at: sentAt.toISOString(), note: 'Handed to the WhatsApp sender (no delivery record).' }
  const s = log.status.toUpperCase()
  if (s === 'FAILED') return { status: 'FAILED', sent_at: sentAt.toISOString(), note: log.failureReason ?? 'WhatsApp could not send it.' }
  if (s === 'SKIPPED') return { status: 'SKIPPED', sent_at: sentAt.toISOString(), note: log.failureReason ?? 'The WhatsApp sender skipped it.' }
  if (s === 'QUEUED') return { status: 'SENDING', sent_at: sentAt.toISOString(), note: null }
  return { status: 'SENT', sent_at: (log.sentAt ?? sentAt).toISOString(), note: s === 'DELIVERED' ? 'Delivered' : s === 'READ' ? 'Read' : null }
}

/** The day it went out is what the sweep believed (end day = sent day + days before), whatever the end date has been edited to since. */
const sweepView = (c: ExpirySubscription & { daysBefore: number }, dayItBelongsTo: Date): ExpirySubscription =>
  ({ ...c, endDay: addDays(istDay(dayItBelongsTo), c.daysBefore) })

export function sentExpiryMessage(c: ExpiryClaim, log: WhatsAppLogRow | null): PlatformScheduledMessage {
  return { ...base(sweepView(c, c.sentAt), c.daysBefore), ...outcome(log, c.sentAt) }
}

/** One admin-touched reminder as a list row. `log` matters only for a rescheduled reminder that has already gone out. */
export function overrideMessage(o: ReminderOverride, log: WhatsAppLogRow | null, wa: WhatsAppState): PlatformScheduledMessage {
  const row = base(sweepView(o, o.scheduledFor), o.daysBefore)
  const slot = `${dayLabel(istDay(o.scheduledFor))}, 8:00 AM`

  if (o.action === 'skipped') return { ...row, scheduled_at: o.scheduledFor.toISOString(), status: 'SKIPPED', sent_at: null, note: o.note ?? 'Skipped by an admin.' }
  if (o.action === 'cancelled') return { ...row, scheduled_at: o.scheduledFor.toISOString(), status: 'CANCELLED', sent_at: null, note: o.note ?? 'Cancelled by an admin.' }

  const when = (o.sendAt ?? o.scheduledFor).toISOString()
  if (o.sentAt) {
    const done = outcome(log, o.sentAt)
    return { ...row, scheduled_at: when, ...done, note: done.note ?? `Rescheduled from ${slot}.` }
  }
  const blocker = whatsappBlocker(o.ownerPhone, wa)
  return { ...row, scheduled_at: when, status: blocker?.status ?? 'SCHEDULED', sent_at: null, note: [`Rescheduled from ${slot}.`, blocker?.note].filter(Boolean).join(' ') }
}

export interface BuildInput {
  subs: ExpirySubscription[]
  claims: ExpiryClaim[]
  overrides: ReminderOverride[]
  /** The sender's latest log row per reminder, keyed by whatsappReference(). */
  logs: Map<string, WhatsAppLogRow>
  todayKey: string
  reminderDays: number[]
  wa: WhatsAppState
}

/** Puts it all together: what is still to come, and what has happened. */
export function buildMessages(i: BuildInput): { upcoming: PlatformScheduledMessage[]; history: PlatformScheduledMessage[] } {
  const claimed: ClaimIndex = new Map()
  for (const c of i.claims) addClaim(claimed, c.subscriptionId, c.daysBefore, c.periodEnd)

  const overridden: ClaimIndex = new Map()
  for (const o of i.overrides) addClaim(overridden, o.subscriptionId, o.daysBefore, o.periodEnd)

  const logOf = (s: ExpirySubscription, d: number) => i.logs.get(whatsappReference(s.subscriptionId, s.periodEnd, d)) ?? null

  const upcoming = upcomingExpiryMessages(i.subs, i.todayKey, i.reminderDays, claimed, i.wa)
  const history: PlatformScheduledMessage[] = []

  for (const c of i.claims) {
    if (isClaimed(overridden, c.subscriptionId, c.daysBefore, c.periodEnd)) continue   // shown through its override instead
    history.push(sentExpiryMessage(c, logOf(c, c.daysBefore)))
  }

  for (const o of i.overrides) {
    const row = overrideMessage(o, logOf(o, o.daysBefore), i.wa)
    const waiting = o.action === 'rescheduled' && !o.sentAt
    const stillAhead = istDay(row.scheduled_at) >= i.todayKey
    ;(waiting || (o.action !== 'rescheduled' && stillAhead) ? upcoming : history).push(row)
  }
  return { upcoming, history }
}

// ── Filtering, sorting, stats ────────────────────────────────────────────────

export interface ListFilters {
  statuses?: string[]
  /** 'YYYY-MM-DD' (IST), inclusive. */
  dateFrom?: string
  dateTo?: string
  search?: string
  sort: 'soonest' | 'latest'
}

export function filterMessages(rows: PlatformScheduledMessage[], f: ListFilters): PlatformScheduledMessage[] {
  const q = f.search?.trim().toLowerCase()
  const out = rows.filter((r) => {
    if (f.statuses?.length && !f.statuses.includes(r.status)) return false
    const day = istDay(r.scheduled_at)
    if (f.dateFrom && day < f.dateFrom) return false
    if (f.dateTo && day > f.dateTo) return false
    if (q) {
      const hay = `${r.salon_name} ${r.owner_name ?? ''} ${r.recipient ?? ''} ${r.plan_name ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  out.sort((a, b) => {
    const d = Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)
    return (f.sort === 'soonest' ? d : -d) || a.salon_name.localeCompare(b.salon_name) || a.days_before - b.days_before
  })
  return out
}

export interface ScheduledStats {
  scheduledToday: number
  upcoming7d: number
  sentToday: number
  failedToday: number
}

export function computeStats(upcoming: PlatformScheduledMessage[], history: PlatformScheduledMessage[], todayKey: string): ScheduledStats {
  const weekEnd = addDays(todayKey, 7)
  const waiting = upcoming.filter((r) => r.status === 'SCHEDULED')
  const dayOf = (r: PlatformScheduledMessage) => istDay(r.sent_at ?? r.scheduled_at)
  return {
    scheduledToday: waiting.filter((r) => istDay(r.scheduled_at) === todayKey).length,
    upcoming7d: waiting.filter((r) => { const d = istDay(r.scheduled_at); return d >= todayKey && d <= weekEnd }).length,
    sentToday: history.filter((r) => r.status === 'SENT' && dayOf(r) === todayKey).length,
    failedToday: history.filter((r) => r.status === 'FAILED' && dayOf(r) === todayKey).length,
  }
}
