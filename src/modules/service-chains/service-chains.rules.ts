// Pure decision rules for the Service Chain runner. No database, no clock of its own (callers pass `now`), so every rule
// can be unit-tested in isolation. The runner gathers the facts with SQL and asks these functions what to do.

export type Eligibility =
  | { kind: 'send' }
  | { kind: 'skip'; reason: string }
  | { kind: 'postpone'; reason: string; appointmentId: string | null }

export interface EligibilityFacts {
  bought: boolean
  completed: boolean
  upcoming: boolean
  /** The nearest upcoming appointment for the step's service, when `upcoming`. */
  upcomingAppointmentId?: string | null
  recent: boolean
}

export interface EligibilityRules {
  wantBought: boolean
  wantCompleted: boolean
  wantUpcoming: boolean
  recentDays: number | null
}

// Order matters: a purchase or a finished service is permanent, so it ends the step; only when neither happened does an
// upcoming appointment make the message wait.
export function decideEligibility(f: EligibilityFacts, r: EligibilityRules): Eligibility {
  if (r.wantBought && f.bought) return { kind: 'skip', reason: 'Client already bought this service' }
  if (r.wantCompleted && f.completed) return { kind: 'skip', reason: 'Client already completed this service' }
  if (r.recentDays !== null && f.recent) return { kind: 'skip', reason: `Client bought this service in the last ${r.recentDays} days` }
  if (r.wantUpcoming && f.upcoming) {
    return { kind: 'postpone', reason: 'Upcoming appointment exists for this service', appointmentId: f.upcomingAppointmentId ?? null }
  }
  return { kind: 'send' }
}

// ── Postponed steps ──────────────────────────────────────────────────────────
export const RECHECK_AFTER_CANCEL_MS = 24 * 60 * 60_000

export type PostponedState = 'completed' | 'cancelled' | 'upcoming' | 'missing'

export interface PostponedFacts {
  /** What happened to the appointment the step is waiting on (read live, so a reschedule is already reflected). */
  appointment: PostponedState
  /** The client bought / completed the step's service some other way while the step waited. */
  boughtOrCompletedElsewhere: boolean
  recheckAt: Date | null
}

export type PostponedAction =
  | { kind: 'skip'; reason: string }
  | { kind: 'wait24h'; recheckAt: Date; reason: string }
  | { kind: 'keep' }
  | { kind: 'release' }

export function decidePostponed(f: PostponedFacts, now: Date): PostponedAction {
  if (f.appointment === 'completed') return { kind: 'skip', reason: 'Appointment completed' }
  if (f.boughtOrCompletedElsewhere) return { kind: 'skip', reason: 'Client already bought or completed this service' }
  if (f.appointment === 'upcoming') return { kind: 'keep' }
  // Cancelled (or vanished): wait a day, then let the normal sender run every check again.
  if (!f.recheckAt) {
    return { kind: 'wait24h', recheckAt: new Date(now.getTime() + RECHECK_AFTER_CANCEL_MS), reason: 'Appointment cancelled, rechecking in 24 hours' }
  }
  return f.recheckAt.getTime() <= now.getTime() ? { kind: 'release' } : { kind: 'keep' }
}

// ── WhatsApp failures ────────────────────────────────────────────────────────
// Meta says this recipient/account cannot receive it, or the setup is wrong: retrying cannot help.
export const BLOCK_CODES = [131047, 131026, 131051, 131049, 131042]
// Meta codes that mean "try again later": rate limit / pair rate limit / temporary server problems.
const TEMPORARY_META_CODES = [4, 80007, 130429, 131056, 131000, 131016, 2, 1, 368]
export const MAX_SEND_ATTEMPTS = 3
const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]

export function isTemporaryFailure(err: { metaCode?: number | null; httpStatus?: number | null; networkCode?: string | null }): boolean {
  if (err.metaCode && BLOCK_CODES.includes(err.metaCode)) return false
  if (err.metaCode && TEMPORARY_META_CODES.includes(err.metaCode)) return true
  if (err.httpStatus) return err.httpStatus === 429 || err.httpStatus >= 500
  // No HTTP response at all: timeout / reset / DNS.
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(String(err.networkCode ?? ''))
}

/** When to retry after `attemptsSoFar` failed attempts (1-based count including the one that just failed), or null to give up. */
export function nextRetryAt(attemptsSoFar: number, now: Date): Date | null {
  if (attemptsSoFar >= MAX_SEND_ATTEMPTS) return null
  return new Date(now.getTime() + BACKOFF_MS[Math.min(attemptsSoFar, BACKOFF_MS.length) - 1])
}
