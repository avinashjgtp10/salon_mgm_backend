import { decideEligibility, decidePostponed, isTemporaryFailure, nextRetryAt, MAX_SEND_ATTEMPTS, RECHECK_AFTER_CANCEL_MS } from './service-chains.rules'

const rules = { wantBought: true, wantCompleted: true, wantUpcoming: true, recentDays: null as number | null }
const none = { bought: false, completed: false, upcoming: false, recent: false }
const now = new Date('2026-11-18T10:00:00Z')

describe('decideEligibility', () => {
  it('sends when nothing is in the way', () => {
    expect(decideEligibility(none, rules)).toEqual({ kind: 'send' })
  })
  it('skips when the service was already bought', () => {
    expect(decideEligibility({ ...none, bought: true }, rules)).toMatchObject({ kind: 'skip', reason: 'Client already bought this service' })
  })
  it('skips when the service was already completed', () => {
    expect(decideEligibility({ ...none, completed: true }, rules)).toMatchObject({ kind: 'skip', reason: 'Client already completed this service' })
  })
  it('postpones, not skips, when an appointment is upcoming, and names it', () => {
    expect(decideEligibility({ ...none, upcoming: true, upcomingAppointmentId: 'apt-1' }, rules))
      .toMatchObject({ kind: 'postpone', appointmentId: 'apt-1' })
  })
  it('a purchase or completed service wins over an upcoming appointment', () => {
    expect(decideEligibility({ ...none, upcoming: true, bought: true }, rules).kind).toBe('skip')
    expect(decideEligibility({ ...none, upcoming: true, completed: true }, rules).kind).toBe('skip')
  })
  it('ignores a rule that is switched off', () => {
    expect(decideEligibility({ ...none, upcoming: true }, { ...rules, wantUpcoming: false })).toEqual({ kind: 'send' })
    expect(decideEligibility({ ...none, bought: true }, { ...rules, wantBought: false })).toEqual({ kind: 'send' })
  })
  it('skips a recent purchase only when the per-step window is set', () => {
    expect(decideEligibility({ ...none, recent: true }, rules)).toEqual({ kind: 'send' })
    expect(decideEligibility({ ...none, recent: true }, { ...rules, recentDays: 30 })).toMatchObject({ kind: 'skip' })
  })
})

describe('decidePostponed', () => {
  const base = { appointment: 'upcoming' as const, boughtOrCompletedElsewhere: false, recheckAt: null }
  it('keeps waiting while the appointment is still upcoming (a reschedule is read live)', () => {
    expect(decidePostponed(base, now)).toEqual({ kind: 'keep' })
  })
  it('skips when the appointment was completed', () => {
    expect(decidePostponed({ ...base, appointment: 'completed' }, now)).toEqual({ kind: 'skip', reason: 'Appointment completed' })
  })
  it('skips when the client bought or completed the service some other way', () => {
    expect(decidePostponed({ ...base, boughtOrCompletedElsewhere: true }, now).kind).toBe('skip')
  })
  it('starts a 24-hour wait when the appointment was cancelled', () => {
    const a = decidePostponed({ ...base, appointment: 'cancelled' }, now)
    expect(a.kind).toBe('wait24h')
    if (a.kind === 'wait24h') expect(a.recheckAt.getTime()).toBe(now.getTime() + RECHECK_AFTER_CANCEL_MS)
  })
  it('keeps waiting until the 24 hours are over, then releases for a full recheck', () => {
    const recheckAt = new Date(now.getTime() + 60_000)
    expect(decidePostponed({ ...base, appointment: 'cancelled', recheckAt }, now)).toEqual({ kind: 'keep' })
    expect(decidePostponed({ ...base, appointment: 'cancelled', recheckAt }, new Date(recheckAt.getTime() + 1))).toEqual({ kind: 'release' })
  })
  it('does not start a second wait when one is already running', () => {
    const recheckAt = new Date(now.getTime() + 3_600_000)
    expect(decidePostponed({ ...base, appointment: 'missing', recheckAt }, now).kind).toBe('keep')
  })
})

describe('WhatsApp failure handling', () => {
  it('never retries a blocked recipient or account', () => {
    expect(isTemporaryFailure({ metaCode: 131026 })).toBe(false)
    expect(isTemporaryFailure({ metaCode: 131047, httpStatus: 500 })).toBe(false)
  })
  it('retries rate limits, server errors and network faults', () => {
    expect(isTemporaryFailure({ metaCode: 130429 })).toBe(true)
    expect(isTemporaryFailure({ httpStatus: 429 })).toBe(true)
    expect(isTemporaryFailure({ httpStatus: 503 })).toBe(true)
    expect(isTemporaryFailure({ networkCode: 'ETIMEDOUT' })).toBe(true)
  })
  it('does not retry a plain client error', () => {
    expect(isTemporaryFailure({ httpStatus: 400 })).toBe(false)
    expect(isTemporaryFailure({})).toBe(false)
  })
  it('backs off 5 min, 30 min, then gives up after the max attempts', () => {
    expect(nextRetryAt(1, now)!.getTime() - now.getTime()).toBe(5 * 60_000)
    expect(nextRetryAt(2, now)!.getTime() - now.getTime()).toBe(30 * 60_000)
    expect(nextRetryAt(MAX_SEND_ATTEMPTS, now)).toBeNull()
  })
})
