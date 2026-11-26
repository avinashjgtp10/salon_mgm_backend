// The actions behind the Scheduled Messages row menu: Send Now, Resend, Reschedule, Skip, Cancel, and the check that sends
// rescheduled reminders when their time comes. Runs against a small in-memory stand-in for the three tables involved.

const sendWa = jest.fn();
jest.mock('../subscriptions/subscription-expiry-whatsapp', () => ({ sendExpiryWhatsApp: (...a: unknown[]) => sendWa(...a) }));
jest.mock('../subscriptions/subscription-expiry-reminder.service', () => ({ REMINDER_DAYS: [5, 4, 3, 2, 1, 0], ensureWhatsappTable: jest.fn(async () => true) }));
jest.mock('../marketing/whatsapp/config/config.repository', () => ({ configRepository: {} }));
jest.mock('../client-announcements/platform-salon', () => ({ getPlatformSalonId: jest.fn(async () => null) }));
jest.mock('../whatsapp-automation/whatsapp-automation.repository', () => ({ whatsappAutomationRepository: {} }));
jest.mock('../../config/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

interface Claim { sub: string; periodEnd: Date; days: number; sentAt: Date }
interface Override { sub: string; periodEnd: Date; days: number; action: string; scheduledFor: Date; sendAt: Date | null; sentAt: Date | null; note: string | null }

const SUB = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PERIOD_END = new Date('2026-12-01T18:29:59.000Z');   // ends 1 Dec (IST)
const live = { subscription_id: SUB, current_period_end: PERIOD_END, end_day: '2026-12-01', plan_name: 'Pro', salon_id: 's1', salon_name: 'Dream Salon', owner_name: 'Asha', owner_phone: '9876543210', days_remaining: 5 };

let liveRow: any = null;
let today = '2026-11-26';
let claims: Claim[] = [];
let overrides: Override[] = [];
let logs: Array<{ ref: string; status: string; failure_reason: string | null }> = [];
let overridesTableMissing = false;
let dueRows: Override[] = [];

// A claim / override is found exactly (the key the actions write) or within a day (how the list and the actions look one up).
const exact = (r: { sub: string; periodEnd: Date; days: number }, sub: string, end: Date, days: number) => r.sub === sub && r.periodEnd.getTime() === new Date(end).getTime() && r.days === days;
const near = (r: { sub: string; periodEnd: Date; days: number }, sub: string, days: number, end: Date) => r.sub === sub && r.days === days && Math.abs(r.periodEnd.getTime() - new Date(end).getTime()) < 86400000;

const query = jest.fn(async (sql: string, p: any[] = []): Promise<{ rows: any[]; rowCount: number }> => {
  const s = sql.replace(/\s+/g, ' ');
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [], rowCount: 0 };
  if (/SELECT to_char\(NOW\(\)/.test(s)) return { rows: [{ today }], rowCount: 1 };
  if (/WHERE s\.id = \$1::uuid/.test(s)) return liveRow && p[0] === SUB ? { rows: [liveRow], rowCount: 1 } : { rows: [], rowCount: 0 };

  if (/SELECT period_end, sent_at FROM subscription_expiry_whatsapp_reminders/.test(s)) {
    const r = claims.find((c) => near({ sub: c.sub, periodEnd: c.periodEnd, days: c.days }, p[0], p[1], p[2]));
    return { rows: r ? [{ period_end: r.periodEnd, sent_at: r.sentAt }] : [], rowCount: r ? 1 : 0 };
  }
  if (/SELECT period_end, action, scheduled_for, sent_at FROM subscription_expiry_whatsapp_overrides/.test(s)) {
    if (overridesTableMissing) throw Object.assign(new Error('no table'), { code: '42P01' });
    const r = overrides.find((o) => near(o, p[0], p[1], p[2]));
    return { rows: r ? [{ period_end: r.periodEnd, action: r.action, scheduled_for: r.scheduledFor, sent_at: r.sentAt }] : [], rowCount: r ? 1 : 0 };
  }
  if (/INSERT INTO subscription_expiry_whatsapp_reminders/.test(s)) {
    if (claims.some((c) => exact({ sub: c.sub, periodEnd: c.periodEnd, days: c.days }, p[0], p[1], p[2]))) return { rows: [], rowCount: 0 };
    claims.push({ sub: p[0], periodEnd: new Date(p[1]), days: p[2], sentAt: new Date() });
    return { rows: [{ subscription_id: p[0] }], rowCount: 1 };
  }
  if (/DELETE FROM subscription_expiry_whatsapp_reminders/.test(s)) {
    claims = claims.filter((c) => !exact({ sub: c.sub, periodEnd: c.periodEnd, days: c.days }, p[0], p[1], p[2]));
    return { rows: [], rowCount: 1 };
  }
  if (/INSERT INTO subscription_expiry_whatsapp_overrides/.test(s)) {
    if (overridesTableMissing) throw Object.assign(new Error('no table'), { code: '42P01' });
    overrides = overrides.filter((o) => !exact(o, p[0], p[1], p[2]));
    overrides.push({ sub: p[0], periodEnd: new Date(p[1]), days: p[2], action: p[3], scheduledFor: new Date(p[4]), sendAt: p[5] ? new Date(p[5]) : null, sentAt: null, note: p[6] });
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE subscription_expiry_whatsapp_overrides SET sent_at = NOW\(\)/.test(s)) {
    const o = overrides.find((x) => exact(x, p[0], p[1], p[2]) && x.action === 'rescheduled' && !x.sentAt);
    if (!o) return { rows: [], rowCount: 0 };
    o.sentAt = new Date();
    return { rows: [{ '?column?': 1 }], rowCount: 1 };
  }
  if (/UPDATE subscription_expiry_whatsapp_overrides SET sent_at = NULL WHERE/.test(s)) {
    const o = overrides.find((x) => exact(x, p[0], p[1], p[2]));
    if (o) o.sentAt = null;
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE subscription_expiry_whatsapp_overrides SET action = 'cancelled'/.test(s)) {
    const o = overrides.find((x) => exact(x, p[0], p[1], p[2]));
    if (o) { o.action = 'cancelled'; o.sentAt = null; o.sendAt = null; o.note = p[3]; }
    return { rows: [], rowCount: 1 };
  }
  if (/FROM subscription_expiry_whatsapp_overrides WHERE action = 'rescheduled' AND sent_at IS NULL AND send_at <= NOW\(\)/.test(s)) {
    return { rows: dueRows.map((o) => ({ subscription_id: o.sub, period_end: o.periodEnd, days_before: o.days, send_at: o.sendAt })), rowCount: dueRows.length };
  }
  if (/unnest\(\$1::text\[\]\)/.test(s)) {
    const rows = p[0].flatMap((ref: string) => {
      const hit = [...logs].reverse().find((l) => l.ref === ref || l.ref.startsWith(ref + ':resend:'));
      return hit ? [{ ref, status: hit.status, failure_reason: hit.failure_reason, sent_at: null }] : [];
    });
    return { rows, rowCount: rows.length };
  }
  throw new Error('unexpected query: ' + s.slice(0, 90));
});
const connect = jest.fn(async () => ({ query: (...a: [string, any[]?]) => query(...a), release: jest.fn() }));
jest.mock('../../config/database', () => ({ __esModule: true, default: { query: (...a: [string, any[]?]) => query(...a), connect: () => connect() } }));

import { platformScheduledMessagesService as svc } from './platform-scheduled-messages.service';
import { whatsappReference, repeatReference } from './platform-scheduled-messages.rules';

const refOf = (d: number) => whatsappReference(SUB, PERIOD_END, d);
const rejects = async (p: Promise<unknown>, status: number, message?: RegExp) => {
  const err: any = await p.then(() => null, (e) => e);
  expect(err).not.toBeNull();
  expect(err.statusCode).toBe(status);
  if (message) expect(err.message).toMatch(message);
};

beforeEach(() => {
  sendWa.mockReset(); sendWa.mockResolvedValue({ sent: true });
  liveRow = { ...live }; today = '2026-11-26'; claims = []; overrides = []; logs = []; overridesTableMissing = false; dueRows = [];
  query.mockClear();
});

describe('sendNow', () => {
  it('claims the reminder (so the sweep will not send it too) and hands it to the WhatsApp sender with the real details', async () => {
    await svc.sendNow(SUB, 5);
    expect(claims).toHaveLength(1);
    expect(sendWa).toHaveBeenCalledTimes(1);
    expect(sendWa.mock.calls[0][0]).toMatchObject({ ownerPhone: '9876543210', ownerName: 'Asha', salonName: 'Dream Salon', planName: 'Pro', daysRemaining: 5, referenceId: refOf(5) });
  });

  it('gives the claim back when WhatsApp is not ready, so nothing is lost and the sweep can still send it', async () => {
    sendWa.mockResolvedValueOnce({ sent: false, skipped: 'template_pending' });
    await rejects(svc.sendNow(SUB, 5), 409, /template is not approved/i);
    expect(claims).toHaveLength(0);
  });

  it('gives the claim back when the send throws', async () => {
    sendWa.mockRejectedValueOnce(new Error('meta down'));
    await expect(svc.sendNow(SUB, 5)).rejects.toThrow('meta down');
    expect(claims).toHaveLength(0);
  });

  it('refuses a reminder that already went out, and one an admin skipped', async () => {
    await svc.sendNow(SUB, 5);
    await rejects(svc.sendNow(SUB, 5), 409, /already handed to WhatsApp/i);
    expect(sendWa).toHaveBeenCalledTimes(1);

    await svc.skip(SUB, 4, null);
    await rejects(svc.sendNow(SUB, 4), 409, /skipped/i);
  });

  it('sends a rescheduled reminder now, under a reference of its own, and marks it sent so the due-time check will not send it again', async () => {
    await svc.reschedule(SUB, 3, new Date(Date.now() + 3600_000), null);
    await svc.sendNow(SUB, 3);
    expect(overrides[0].sentAt).not.toBeNull();
    expect(sendWa.mock.calls[0][0].referenceId).toMatch(new RegExp(`^${refOf(3)}:resend:\\d+$`));
    await rejects(svc.sendNow(SUB, 3), 409, /already sent/i);
  });

  it('refuses a subscription that was renewed or ended, and an unknown reminder', async () => {
    liveRow = null;
    await rejects(svc.sendNow(SUB, 5), 404, /no longer needs a reminder/i);
    liveRow = { ...live };
    await rejects(svc.sendNow(SUB, 9), 400);
    expect(sendWa).not.toHaveBeenCalled();
  });
});

describe('resend', () => {
  it('sends again under a fresh reference, so the sender\'s duplicate guard lets it through', async () => {
    await svc.sendNow(SUB, 5);
    sendWa.mockClear();
    await svc.resend(SUB, 5);
    expect(sendWa).toHaveBeenCalledTimes(1);
    const reference = sendWa.mock.calls[0][0].referenceId;
    expect(reference).toMatch(new RegExp(`^${refOf(5)}:resend:\\d+$`));
    expect(reference).not.toBe(refOf(5));   // the original reference is the one the duplicate guard already holds
  });

  it('refuses a reminder that was never sent, or one an admin skipped', async () => {
    await rejects(svc.resend(SUB, 5), 409, /not been sent yet/i);
    await svc.skip(SUB, 4, null);
    await rejects(svc.resend(SUB, 4), 409, /skipped, cancelled/i);
  });
});

describe('skip', () => {
  it('writes the claim (what stops the sweep) and the override (what the list shows), on the reminder\'s own slot', async () => {
    await svc.skip(SUB, 4, 'admin-1');
    expect(claims).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ sub: SUB, days: 4, action: 'skipped' });
    expect(overrides[0].scheduledFor.toISOString()).toBe('2026-11-27T02:30:00.000Z');   // 4 days before 1 Dec, 8 AM IST
    expect(sendWa).not.toHaveBeenCalled();
  });

  it('cannot skip twice or skip what was already sent', async () => {
    await svc.skip(SUB, 4, null);
    await rejects(svc.skip(SUB, 4, null), 409, /already skipped/i);
    await svc.sendNow(SUB, 5);
    await rejects(svc.skip(SUB, 5, null), 409, /already sent/i);
  });

  it('turns a waiting reschedule into a skip', async () => {
    await svc.reschedule(SUB, 3, new Date(Date.now() + 3600_000), null);
    await svc.skip(SUB, 3, null);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ action: 'skipped', sendAt: null });
  });

  it('says plainly when the one-time migration has not been run', async () => {
    overridesTableMissing = true;
    await rejects(svc.skip(SUB, 4, null), 503, /Migration\/create_subscription_expiry_whatsapp_overrides\.sql/);
  });
});

describe('cancel', () => {
  it('cancels every reminder still ahead for the subscription, and leaves what already went out', async () => {
    today = '2026-11-28';   // 5- and 4-day slots (26, 27 Nov) are behind us; 3, 2, 1, 0 are ahead
    await svc.sendNow(SUB, 3);   // already handed over
    const out = await svc.cancel(SUB, 2, null);
    expect(out.cancelled).toBe(3);   // 2, 1, 0
    expect(overrides.map((o) => o.days).sort()).toEqual([0, 1, 2]);
    expect(overrides.every((o) => o.action === 'cancelled')).toBe(true);
    expect(claims.map((c) => c.days).sort()).toEqual([0, 1, 2, 3]);   // each cancelled one also claimed, so the sweep leaves it alone
  });

  it('says so when there is nothing left to cancel', async () => {
    await svc.cancel(SUB, 5, null);
    await rejects(svc.cancel(SUB, 5, null), 409, /nothing left to cancel/i);
  });
});

describe('reschedule', () => {
  const later = (hours: number) => new Date(Date.now() + hours * 3600_000);

  it('records the new time against the claim and keeps the original slot', async () => {
    await svc.reschedule(SUB, 5, later(5), 'admin-1');
    expect(claims).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ action: 'rescheduled', days: 5 });
    expect(overrides[0].sendAt).not.toBeNull();
    expect(overrides[0].scheduledFor.toISOString()).toBe('2026-11-26T02:30:00.000Z');
    expect(sendWa).not.toHaveBeenCalled();   // nothing goes out until its time
  });

  it('rejects a time in the past, or after the subscription has ended', async () => {
    await rejects(svc.reschedule(SUB, 5, new Date(Date.now() - 1000), null), 400, /future/i);
    await rejects(svc.reschedule(SUB, 5, new Date(PERIOD_END.getTime() + 3600_000), null), 400, /before the subscription ends/i);
    await rejects(svc.reschedule(SUB, 5, new Date('nonsense'), null), 400);
  });

  it('refuses an owner with no phone number', async () => {
    liveRow = { ...live, owner_phone: null };
    await rejects(svc.reschedule(SUB, 5, later(5), null), 409, /no phone number/i);
  });

  it('refuses a reminder that was already delivered, but lets a FAILED one be sent again at a new time', async () => {
    await svc.sendNow(SUB, 5);
    logs.push({ ref: refOf(5), status: 'DELIVERED', failure_reason: null });
    await rejects(svc.reschedule(SUB, 5, later(5), null), 409, /already sent/i);

    logs = [{ ref: refOf(5), status: 'FAILED', failure_reason: '(#132001)' }];
    await svc.reschedule(SUB, 5, later(5), null);
    expect(overrides[0].action).toBe('rescheduled');
    expect(overrides[0].scheduledFor.toISOString()).toBe(new Date(claims[0].sentAt.getTime()).toISOString().slice(0, 10) + 'T02:30:00.000Z');
  });

  it('can move an already rescheduled reminder again', async () => {
    await svc.reschedule(SUB, 5, later(5), null);
    await svc.reschedule(SUB, 5, later(7), null);
    expect(overrides).toHaveLength(1);
  });
});

describe('runRescheduledTick', () => {
  const due = (days = 5): Override => ({ sub: SUB, periodEnd: PERIOD_END, days, action: 'rescheduled', scheduledFor: new Date('2026-11-26T02:30:00.000Z'), sendAt: new Date('2026-11-26T04:00:00.000Z'), sentAt: null, note: null });

  it('sends a due rescheduled reminder once', async () => {
    const o = due(); overrides = [o]; dueRows = [o];
    expect(await svc.runRescheduledTick()).toBe(1);
    expect(sendWa).toHaveBeenCalledTimes(1);
    expect(sendWa.mock.calls[0][0].referenceId).toBe(repeatReference(refOf(5), o.sendAt!.getTime()));
    expect(o.sentAt).not.toBeNull();
    // a second pass (or a second server) finds it already marked
    expect(await svc.runRescheduledTick()).toBe(0);
    expect(sendWa).toHaveBeenCalledTimes(1);
  });

  it('un-marks it when WhatsApp is not ready, so it is tried again at the next pass', async () => {
    const o = due(); overrides = [o]; dueRows = [o];
    sendWa.mockResolvedValueOnce({ sent: false, skipped: 'platform_not_configured' });
    expect(await svc.runRescheduledTick()).toBe(0);
    expect(o.sentAt).toBeNull();
    expect(await svc.runRescheduledTick()).toBe(1);
  });

  it('cancels it when the subscription was renewed meanwhile, without sending', async () => {
    const o = due(); overrides = [o]; dueRows = [o];
    liveRow = null;
    expect(await svc.runRescheduledTick()).toBe(0);
    expect(sendWa).not.toHaveBeenCalled();
    expect(o).toMatchObject({ action: 'cancelled', sentAt: null });
    expect(o.note).toMatch(/renewed or has ended/i);
  });

  it('does nothing when the overrides table does not exist yet', async () => {
    overridesTableMissing = true;
    query.mockImplementationOnce(async () => { throw Object.assign(new Error('no table'), { code: '42P01' }); });
    expect(await svc.runRescheduledTick()).toBe(0);
  });
});
