import {
  ClaimIndex, ExpiryClaim, ExpirySubscription, PlatformScheduledMessage, ReminderOverride, WhatsAppLogRow, WhatsAppState,
  addClaim, addDays, buildMessages, computeStats, dayLabel, filterMessages, istDay, repeatReference, sentExpiryMessage,
  sweepInstant, upcomingExpiryMessages, whatsappReference,
} from './platform-scheduled-messages.rules'

const DAYS = [5, 4, 3, 2, 1, 0]
const READY: WhatsAppState = { configured: true, templateApproved: true }

const sub = (over: Partial<ExpirySubscription> = {}): ExpirySubscription => ({
  subscriptionId: 'sub-1',
  periodEnd: new Date('2026-12-01T18:29:59.000Z'),   // 1 Dec 23:59 IST
  endDay: '2026-12-01',
  planName: 'Pro',
  salonId: 'salon-1',
  salonName: 'Dream Salon',
  ownerName: 'Asha Rao',
  ownerPhone: '9876543210',
  ...over,
})

const none = (): ClaimIndex => new Map()
const claims = (...list: Array<[string, number, Date]>): ClaimIndex => {
  const index: ClaimIndex = new Map()
  for (const [id, d, end] of list) addClaim(index, id, d, end)
  return index
}

describe('calendar helpers', () => {
  it('adds days across month and year ends without a time zone', () => {
    expect(addDays('2026-12-01', -5)).toBe('2026-11-26')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('sends at 8 AM IST, which is 02:30 UTC', () => {
    expect(sweepInstant('2026-11-26')).toBe('2026-11-26T02:30:00.000Z')
  })

  it('finds the IST day of an instant, even when UTC is still the day before', () => {
    expect(istDay('2026-11-25T20:00:00.000Z')).toBe('2026-11-26')   // 01:30 IST next morning
    expect(istDay('2026-11-26T02:30:00.000Z')).toBe('2026-11-26')
  })

  it('labels a day', () => expect(dayLabel('2026-12-01')).toBe('1 Dec 2026'))
})

describe('upcomingExpiryMessages', () => {
  it('plans one WhatsApp reminder per reminder day, from today onwards', () => {
    const rows = upcomingExpiryMessages([sub()], '2026-11-24', DAYS, none(), READY)
    expect(rows).toHaveLength(6)
    // 5 days before 1 Dec is 26 Nov, 8 AM IST
    const first = [...rows].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0]
    expect(first.scheduled_at).toBe('2026-11-26T02:30:00.000Z')
    expect(first.days_before).toBe(5)
    expect(first.status).toBe('SCHEDULED')
    expect(first.recipient).toBe('9876543210')
    expect(first.message_preview).toBe('Dream Salon: Pro plan expires in 5 days (1 Dec 2026)')
  })

  it('drops reminder days that are already behind us', () => {
    // On 30 Nov only the 1-day (30 Nov) and 0-day (1 Dec) reminders are left; 5 to 2 days before were 26-29 Nov.
    const rows = upcomingExpiryMessages([sub()], '2026-11-30', DAYS, none(), READY)
    expect(rows.map((r) => r.days_before).sort()).toEqual([0, 1])
  })

  it("keeps today's reminder (the sweep may not have run yet)", () => {
    const rows = upcomingExpiryMessages([sub()], '2026-12-01', DAYS, none(), READY)
    expect(rows.map((r) => r.days_before)).toEqual([0])
  })

  it('leaves out reminders already handed over', () => {
    const rows = upcomingExpiryMessages([sub()], '2026-11-26', DAYS, claims(['sub-1', 5, sub().periodEnd]), READY)
    expect(rows.map((r) => r.days_before)).not.toContain(5)
    expect(rows).toHaveLength(5)
  })

  it('still matches a claim whose period end was read in another time zone (IST machine vs UTC server)', () => {
    // subscriptions.current_period_end has no time zone, so the same row is 5.5 hours apart on the two machines.
    const claimedElsewhere = claims(['sub-1', 5, new Date(sub().periodEnd.getTime() - 5.5 * 3600_000)])
    const rows = upcomingExpiryMessages([sub()], '2026-11-26', DAYS, claimedElsewhere, READY)
    expect(rows.map((r) => r.days_before)).not.toContain(5)
  })

  it('treats a period end moved by days as a new reminder', () => {
    const moved = claims(['sub-1', 5, new Date('2026-12-04T18:29:59.000Z')])
    const rows = upcomingExpiryMessages([sub()], '2026-11-26', DAYS, moved, READY)
    expect(rows.map((r) => r.days_before)).toContain(5)
  })

  it('does not mix up claims of different subscriptions or day counts', () => {
    const other = claims(['sub-2', 5, sub().periodEnd], ['sub-1', 4, sub().periodEnd])
    const rows = upcomingExpiryMessages([sub()], '2026-11-26', DAYS, other, READY)
    expect(rows.map((r) => r.days_before)).toContain(5)
    expect(rows.map((r) => r.days_before)).not.toContain(4)
  })

  it('explains why a reminder cannot go yet', () => {
    const phoneless = upcomingExpiryMessages([sub({ ownerPhone: ' ' })], '2026-12-01', DAYS, none(), READY)
    expect(phoneless[0]).toMatchObject({ status: 'SKIPPED', note: expect.stringMatching(/no phone/i) })

    const notConnected = upcomingExpiryMessages([sub()], '2026-12-01', DAYS, none(), { configured: false, templateApproved: false })
    expect(notConnected[0]).toMatchObject({ status: 'SCHEDULED', note: expect.stringMatching(/connected/i) })

    const pending = upcomingExpiryMessages([sub()], '2026-12-01', DAYS, none(), { configured: true, templateApproved: false })
    expect(pending[0]).toMatchObject({ status: 'SCHEDULED', note: expect.stringMatching(/approved/i) })

    const ready = upcomingExpiryMessages([sub()], '2026-12-01', DAYS, none(), READY)
    expect(ready[0].note).toBeNull()
  })

  it('gives every row a unique id', () => {
    const rows = upcomingExpiryMessages([sub(), sub({ subscriptionId: 'sub-2' })], '2026-11-24', DAYS, none(), READY)
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })
})

describe('sentExpiryMessage', () => {
  const claim = (over: Partial<ExpiryClaim> = {}): ExpiryClaim => ({ ...sub(), daysBefore: 3, sentAt: new Date('2026-11-28T02:30:01.000Z'), ...over })

  it('sits on the day it was sent, even if the end date was edited afterwards', () => {
    // The sweep sent the 5-day reminder on 25 Nov, so it believed the end was 30 Nov; the row now says 1 Dec.
    const r = sentExpiryMessage(claim({ endDay: '2026-12-01', daysBefore: 5, sentAt: new Date('2026-11-25T02:30:00.673Z') }), null)
    expect(r.scheduled_at).toBe('2026-11-25T02:30:00.000Z')
    expect(r.message_preview).toBe('Dream Salon: Pro plan expires in 5 days (30 Nov 2026)')
  })

  it("reads the real outcome from the sender's log", () => {
    expect(sentExpiryMessage(claim(), { status: 'FAILED', failureReason: '(#132001) Template name does not exist', sentAt: null }))
      .toMatchObject({ status: 'FAILED', note: '(#132001) Template name does not exist' })
    expect(sentExpiryMessage(claim(), { status: 'DELIVERED', failureReason: null, sentAt: new Date('2026-11-28T02:30:05.000Z') }))
      .toMatchObject({ status: 'SENT', note: 'Delivered', sent_at: '2026-11-28T02:30:05.000Z' })
    expect(sentExpiryMessage(claim(), { status: 'QUEUED', failureReason: null, sentAt: null })).toMatchObject({ status: 'SENDING' })
    expect(sentExpiryMessage(claim(), { status: 'SKIPPED', failureReason: null, sentAt: null })).toMatchObject({ status: 'SKIPPED' })
  })

  it('does not claim it was delivered when there is no log row', () => {
    const r = sentExpiryMessage(claim(), null)
    expect(r.status).toBe('SENT')
    expect(r.note).toMatch(/no delivery record/i)
  })

  it('uses the same reference the sender stamps on its log', () => {
    expect(whatsappReference('sub-1', new Date('2026-12-01T18:29:59.000Z'), 3)).toBe('sub-1:2026-12-01T18:29:59.000Z:3')
  })
})

describe('filterMessages', () => {
  const rows = upcomingExpiryMessages(
    [sub(), sub({ subscriptionId: 'sub-2', salonId: 'salon-2', salonName: 'Glow Studio', ownerName: 'Meera', ownerPhone: '9123456789', endDay: '2026-12-05', periodEnd: new Date('2026-12-05T18:29:59.000Z') })],
    '2026-11-24', DAYS, none(), READY,
  )

  it('searches salon, owner and phone', () => {
    const f = { sort: 'soonest' as const }
    expect(new Set(filterMessages(rows, { ...f, search: 'glow' }).map((r) => r.salon_name))).toEqual(new Set(['Glow Studio']))
    expect(new Set(filterMessages(rows, { ...f, search: 'asha' }).map((r) => r.salon_name))).toEqual(new Set(['Dream Salon']))
    expect(new Set(filterMessages(rows, { ...f, search: '91234' }).map((r) => r.salon_name))).toEqual(new Set(['Glow Studio']))
  })

  it('filters by status', () => {
    const mixed: PlatformScheduledMessage[] = [{ ...rows[0], status: 'SKIPPED' }, { ...rows[1], status: 'SCHEDULED' }]
    expect(filterMessages(mixed, { sort: 'soonest', statuses: ['SKIPPED'] })).toHaveLength(1)
  })

  it('filters by date, inclusive, on the IST day', () => {
    const out = filterMessages(rows, { sort: 'soonest', dateFrom: '2026-11-26', dateTo: '2026-11-26' })
    expect(out).toHaveLength(1)
    expect(out[0].salon_name).toBe('Dream Salon')
  })

  it('sorts soonest and latest', () => {
    const soon = filterMessages(rows, { sort: 'soonest' })
    const late = filterMessages(rows, { sort: 'latest' })
    expect(soon[0].scheduled_at <= soon[soon.length - 1].scheduled_at).toBe(true)
    expect(late[0].scheduled_at >= late[late.length - 1].scheduled_at).toBe(true)
  })
})

describe('computeStats', () => {
  it('counts what is due today, in the next 7 days, and what went out today', () => {
    const upcoming = upcomingExpiryMessages([sub()], '2026-11-26', DAYS, none(), READY)
    const history: PlatformScheduledMessage[] = [
      { ...upcoming[0], status: 'SENT', sent_at: '2026-11-26T02:30:03.000Z', scheduled_at: '2026-11-26T02:30:00.000Z' },
      { ...upcoming[1], status: 'FAILED', sent_at: '2026-11-26T02:30:04.000Z', scheduled_at: '2026-11-26T02:30:00.000Z' },
      { ...upcoming[2], status: 'SENT', sent_at: '2026-11-25T02:30:04.000Z', scheduled_at: '2026-11-25T02:30:00.000Z' },
    ]
    const s = computeStats(upcoming, history, '2026-11-26')
    expect(s.scheduledToday).toBe(1)       // today's reminder
    expect(s.upcoming7d).toBe(6)           // all six days, 26 Nov..1 Dec
    expect(s.sentToday).toBe(1)
    expect(s.failedToday).toBe(1)
  })
})

describe('buildMessages (claims + admin overrides)', () => {
  const claimOf = (d: number, sentAt: string, over: Partial<ExpiryClaim> = {}): ExpiryClaim => ({ ...sub(), daysBefore: d, sentAt: new Date(sentAt), ...over })
  const overrideOf = (d: number, action: ReminderOverride['action'], over: Partial<ReminderOverride> = {}): ReminderOverride => ({
    ...sub(), daysBefore: d, action, scheduledFor: new Date(sweepInstant(addDays('2026-12-01', -d))), sendAt: null, sentAt: null, note: null, ...over,
  })
  const build = (o: { claims?: ExpiryClaim[]; overrides?: ReminderOverride[]; logs?: Map<string, WhatsAppLogRow>; today?: string; wa?: WhatsAppState }) =>
    buildMessages({ subs: [sub()], claims: o.claims ?? [], overrides: o.overrides ?? [], logs: o.logs ?? new Map(), todayKey: o.today ?? '2026-11-26', reminderDays: DAYS, wa: o.wa ?? READY })

  it('a claim on its own is a sent reminder in History, and is no longer upcoming', () => {
    const { upcoming, history } = build({ claims: [claimOf(5, '2026-11-26T02:30:01.000Z')] })
    expect(history.map((r) => [r.days_before, r.status])).toEqual([[5, 'SENT']])
    expect(upcoming.map((r) => r.days_before)).not.toContain(5)
  })

  it('a claim WITH an override is never "sent": the override decides', () => {
    // Skip writes a claim too (so the sweep leaves it alone); it must not turn up in History as Sent.
    const { upcoming, history } = build({ claims: [claimOf(4, '2026-11-26T05:00:00.000Z')], overrides: [overrideOf(4, 'skipped')] })
    expect(history).toHaveLength(0)
    const row = upcoming.find((r) => r.days_before === 4)!
    expect(row).toMatchObject({ status: 'SKIPPED', note: 'Skipped by an admin.', scheduled_at: '2026-11-27T02:30:00.000Z' })
    expect(upcoming.filter((r) => r.days_before === 4)).toHaveLength(1)   // and not also as a plain upcoming row
  })

  it('matches the override to its claim across the IST / UTC period-end shift', () => {
    const shifted = claimOf(4, '2026-11-26T05:00:00.000Z', { periodEnd: new Date(sub().periodEnd.getTime() - 5.5 * 3600_000) })
    const { history } = build({ claims: [shifted], overrides: [overrideOf(4, 'cancelled')] })
    expect(history).toHaveLength(0)
  })

  it('shows a cancelled reminder as Cancelled, upcoming while its day is ahead and in History once it has passed', () => {
    const ahead = build({ claims: [claimOf(3, '2026-11-26T05:00:00.000Z')], overrides: [overrideOf(3, 'cancelled')] })
    expect(ahead.upcoming.find((r) => r.days_before === 3)).toMatchObject({ status: 'CANCELLED', note: 'Cancelled by an admin.' })

    const passed = build({ claims: [claimOf(5, '2026-11-25T05:00:00.000Z')], overrides: [overrideOf(5, 'cancelled')], today: '2026-11-30' })
    expect(passed.history.find((r) => r.days_before === 5)).toMatchObject({ status: 'CANCELLED' })
    expect(passed.upcoming.map((r) => r.days_before)).not.toContain(5)
  })

  it('a rescheduled reminder waits at its new time, saying where it came from', () => {
    const sendAt = new Date('2026-11-28T10:00:00.000Z')
    const { upcoming } = build({ claims: [claimOf(5, '2026-11-26T05:00:00.000Z')], overrides: [overrideOf(5, 'rescheduled', { sendAt })] })
    const row = upcoming.find((r) => r.days_before === 5)!
    expect(row).toMatchObject({ status: 'SCHEDULED', scheduled_at: '2026-11-28T10:00:00.000Z', sent_at: null })
    expect(row.note).toBe('Rescheduled from 26 Nov 2026, 8:00 AM.')
  })

  it('a waiting rescheduled reminder still says what is blocking it', () => {
    const { upcoming } = build({
      claims: [claimOf(5, '2026-11-26T05:00:00.000Z')], overrides: [overrideOf(5, 'rescheduled', { sendAt: new Date('2026-11-28T10:00:00.000Z') })],
      wa: { configured: false, templateApproved: false },
    })
    expect(upcoming.find((r) => r.days_before === 5)!.note).toMatch(/Rescheduled from .* connected/)
  })

  it('a rescheduled reminder that has gone out is History, with the sender\'s real outcome (including its repeat references)', () => {
    const o = overrideOf(5, 'rescheduled', { sendAt: new Date('2026-11-28T10:00:00.000Z'), sentAt: new Date('2026-11-28T10:05:00.000Z') })
    const logs = new Map([[whatsappReference('sub-1', o.periodEnd, 5), { status: 'FAILED', failureReason: '(#132001) Template name does not exist', sentAt: null }]])
    const { upcoming, history } = build({ claims: [claimOf(5, '2026-11-26T05:00:00.000Z')], overrides: [o], logs })
    expect(upcoming.map((r) => r.days_before)).not.toContain(5)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ status: 'FAILED', scheduled_at: '2026-11-28T10:00:00.000Z', note: '(#132001) Template name does not exist' })
  })

  it('every row carries its subscription id, for the actions', () => {
    const { upcoming } = build({})
    expect(upcoming.every((r) => r.subscription_id === 'sub-1')).toBe(true)
  })

  it('repeat references never collide with the original one', () => {
    const canonical = whatsappReference('sub-1', sub().periodEnd, 5)
    expect(repeatReference(canonical, 1700000000000)).toBe(`${canonical}:resend:1700000000000`)
    expect(repeatReference(canonical, 1)).not.toBe(canonical)
  })
})
