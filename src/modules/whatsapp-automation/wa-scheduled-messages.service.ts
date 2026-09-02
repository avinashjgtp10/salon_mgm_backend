// ============================================================
// SalonOx — Scheduled Templates (wa_scheduled_messages) Service
// ============================================================

import logger from '../../config/logger'
import { whatsappAutomationRepository } from './whatsapp-automation.repository'
import { waScheduledMessagesRepository } from './wa-scheduled-messages.repository'
import { whatsappAutomationService } from './whatsapp-automation.service'
import {
  AutomationEventType,
  ScheduledMessage,
  ListScheduledMessagesFilters,
} from './whatsapp-automation.types'

// ── IST date helpers ─────────────────────────────────────────────────────────

function formatDateIST(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
}

// Real UTC Date for a given IST calendar date + hour (IST = UTC+5:30).
function buildUtcForIST(year: number, month: number, day: number, hourIST: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hourIST - 5, -30, 0))
}

// Next future occurrence (IST) of a "MM-DD" day/month, at hourIST:00 — used for
// birthday_wishes (recurs yearly) and new_year_campaign (fixed Jan 1).
function nextOccurrenceIST(dayMonth: string, hourIST = 9): Date {
  const [mm, dd] = dayMonth.split('-').map(Number)
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // YYYY-MM-DD
  const thisYear = Number(todayIST.split('-')[0])
  let candidate = buildUtcForIST(thisYear, mm, dd, hourIST)
  if (candidate.getTime() <= Date.now()) candidate = buildUtcForIST(thisYear + 1, mm, dd, hourIST)
  return candidate
}

export const waScheduledMessagesService = {

  // ── List / read ──────────────────────────────────────────────────────────
  async list(filters: ListScheduledMessagesFilters): Promise<{ data: ScheduledMessage[]; total: number }> {
    return waScheduledMessagesRepository.list(filters)
  },

  // ── Group A — schedule a real row at source-entity-creation time ───────────

  async schedulePackageExpiry(params: {
    salonId: string; clientId: string | null; phone: string; countryCode?: string | null
    packageId: string; packageName: string; clientName: string; expiryDate: string | Date
    remainingSessions: number
  }): Promise<void> {
    const expiry = new Date(params.expiryDate)
    if (isNaN(expiry.getTime())) return
    const plans: Array<{ eventType: AutomationEventType; offsetMs: number; label: string }> = [
      { eventType: 'package_expiring_7d',  offsetMs: 7 * 24 * 3600_000, label: 'expires in 7 days' },
      { eventType: 'package_expiring_24h', offsetMs: 24 * 3600_000,     label: 'expires tomorrow' },
    ]
    for (const p of plans) {
      const scheduledAt = new Date(expiry.getTime() - p.offsetMs)
      if (scheduledAt.getTime() <= Date.now()) continue // already past — skip silently
      await waScheduledMessagesRepository.upsertScheduled({
        salonId: params.salonId, clientId: params.clientId, phone: params.phone, countryCode: params.countryCode,
        eventType: p.eventType, referenceId: params.packageId, referenceType: 'package',
        scheduledAt,
        // Same 4-slot shape the approved templates expect (see the removed
        // runPackageExpiringReminders) — every slot must carry a real value,
        // never '', or Meta rejects the send with 131008 "Required parameter
        // is missing".
        variables: p.eventType === 'package_expiring_7d'
          ? { '1': params.clientName, '2': params.packageName, '3': formatDateIST(expiry), '4': String(params.remainingSessions ?? 0) }
          : { '1': params.clientName, '2': params.packageName, '3': String(params.remainingSessions ?? 0), '4': formatDateIST(expiry) },
        messagePreview: `${params.packageName} ${p.label}`,
        isPreview: false,
      })
    }
  },

  async scheduleMembershipExpiry(params: {
    salonId: string; clientId: string | null; phone: string; countryCode?: string | null
    membershipId: string; membershipName: string; clientName: string; expiryDate: string | Date
    remainingBalance: number
  }): Promise<void> {
    const expiry = new Date(params.expiryDate)
    if (isNaN(expiry.getTime())) return
    const plans: Array<{ eventType: AutomationEventType; offsetMs: number; label: string }> = [
      { eventType: 'membership_expiring_7d',  offsetMs: 7 * 24 * 3600_000, label: 'expires in 7 days' },
      { eventType: 'membership_expiring_24h', offsetMs: 24 * 3600_000,     label: 'expires tomorrow' },
    ]
    for (const p of plans) {
      const scheduledAt = new Date(expiry.getTime() - p.offsetMs)
      if (scheduledAt.getTime() <= Date.now()) continue
      await waScheduledMessagesRepository.upsertScheduled({
        salonId: params.salonId, clientId: params.clientId, phone: params.phone, countryCode: params.countryCode,
        eventType: p.eventType, referenceId: params.membershipId, referenceType: 'membership',
        scheduledAt,
        // Same 4-slot shape the approved templates expect (see the removed
        // runMembershipExpiringReminders) — every slot must carry a real
        // value, never '', or Meta rejects the send with 131008.
        variables: p.eventType === 'membership_expiring_7d'
          ? { '1': params.clientName, '2': params.membershipName, '3': formatDateIST(expiry), '4': String(params.remainingBalance ?? 0) }
          : { '1': params.clientName, '2': params.membershipName, '3': String(params.remainingBalance ?? 0), '4': formatDateIST(expiry) },
        messagePreview: `${params.membershipName} ${p.label}`,
        isPreview: false,
      })
    }
  },

  async scheduleAppointmentReminder(params: {
    salonId: string; clientId: string | null; phone: string; countryCode?: string | null
    appointmentId: string; scheduledAt: string | Date
    clientName: string; salonName: string; serviceName: string
    // Package-linked reminder gets its own event + package name; plain appointment gets staff name instead.
    packageLinked?: { packageName: string } | null
    staffName?: string | null
  }): Promise<void> {
    const apptTime = new Date(params.scheduledAt)
    if (isNaN(apptTime.getTime())) return
    const reminderAt = new Date(apptTime.getTime() - 24 * 3600_000)
    if (reminderAt.getTime() <= Date.now()) return // already <24h out — the old-instant-fire path (removed) would've caught this; skip here

    const eventType: AutomationEventType = params.packageLinked ? 'package_appointment_reminder_24h' : 'service_reminder_24h'
    const dateStr = formatDateIST(apptTime)
    const timeStr = new Date(apptTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })

    await waScheduledMessagesRepository.upsertScheduled({
      salonId: params.salonId, clientId: params.clientId, phone: params.phone, countryCode: params.countryCode,
      eventType, referenceId: params.appointmentId, referenceType: 'appointment',
      scheduledAt: reminderAt,
      variables: params.packageLinked
        ? { '1': params.clientName, '2': params.salonName, '3': dateStr, '4': timeStr, '5': params.serviceName, '6': params.packageLinked.packageName }
        : { '1': params.clientName, '2': params.salonName, '3': dateStr, '4': timeStr, '5': params.serviceName, '6': params.staffName ?? 'our team' },
      messagePreview: `Appointment reminder — ${params.serviceName} on ${dateStr} ${timeStr}`,
      isPreview: false,
    })
  },

  async scheduleBirthday(params: {
    salonId: string; clientId: string; phone: string; countryCode?: string | null
    fullName: string; salonName: string; birthdayDayMonth: string
  }): Promise<void> {
    const scheduledAt = nextOccurrenceIST(params.birthdayDayMonth, 9)
    await waScheduledMessagesRepository.upsertScheduled({
      salonId: params.salonId, clientId: params.clientId, phone: params.phone, countryCode: params.countryCode,
      eventType: 'birthday_wishes', referenceId: params.clientId, referenceType: 'client',
      scheduledAt,
      variables: { '1': params.fullName, '2': params.salonName },
      messagePreview: `Happy Birthday, ${params.fullName}!`,
      isPreview: false,
    })
  },

  // ── Group B — 1-day rolling preview, called from the nightly poll slot ─────

  async upsertGroupBPreview(eventType: 'pending_payment_reminder' | 'we_miss_you_30d' | 'we_miss_you_60d' | 'we_miss_you_90d'): Promise<void> {
    try {
      const tomorrow = new Date(Date.now() + 24 * 3600_000)
      const currentRefIds: string[] = []

      if (eventType === 'pending_payment_reminder') {
        const sales = await whatsappAutomationRepository.getOverdueSales()
        for (const sale of sales) {
          if (!sale.phone_number) continue
          currentRefIds.push(sale.sale_id)
          const dueDate = sale.due_date ? formatDateIST(sale.due_date) : 'as soon as possible'
          await waScheduledMessagesRepository.upsertScheduled({
            salonId: sale.salon_id, clientId: sale.client_id, phone: sale.phone_number, countryCode: sale.phone_country_code,
            eventType, referenceId: sale.sale_id, referenceType: 'sale', scheduledAt: tomorrow,
            variables: { '1': sale.client_name ?? 'Valued Customer', '2': sale.total_amount ?? '0', '3': dueDate },
            messagePreview: `Payment reminder — ₹${sale.total_amount ?? '0'} due`,
            isPreview: true,
          })
        }
      } else {
        const days = eventType === 'we_miss_you_30d' ? 30 : eventType === 'we_miss_you_60d' ? 60 : 90
        const clients = await whatsappAutomationRepository.getInactiveClients(days as 30 | 60 | 90)
        for (const client of clients) {
          if (!client.phone_number) continue
          currentRefIds.push(client.client_id)
          await waScheduledMessagesRepository.upsertScheduled({
            salonId: client.salon_id, clientId: client.client_id, phone: client.phone_number, countryCode: client.phone_country_code,
            eventType, referenceId: client.client_id, referenceType: 'client', scheduledAt: tomorrow,
            variables: { '1': client.full_name, '2': String(days), '3': client.salon_name ?? 'our salon' },
            messagePreview: `We miss you, ${client.full_name}!`,
            isPreview: true,
          })
        }
      }

      // Rolling cleanup: a candidate that no longer qualifies (balance paid,
      // client came back) loses its still-unfired preview row.
      await waScheduledMessagesRepository.deleteStalePreview(eventType, currentRefIds)
    } catch (err: any) {
      logger.error(`[WA-SCHED] upsertGroupBPreview(${eventType}) error:`, err?.message)
    }
  },

  // New Year has no natural per-entity creation hook — seeded daily in the
  // run-up to Jan 1 (harmless to re-run: upsertScheduled just moves the date).
  async seedNewYearRows(): Promise<void> {
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      // Only worth seeding from Dec 1 onward — any earlier and "next Jan 1" is
      // months away and would just get re-upserted to the same date daily anyway.
      if (nowIST.getMonth() !== 11) return
      const clients = await whatsappAutomationRepository.getAllActiveSalonClients()
      const scheduledAt = nextOccurrenceIST('01-01', 9)
      for (const client of clients) {
        if (!client.phone_number) continue
        await waScheduledMessagesRepository.upsertScheduled({
          salonId: client.salon_id, clientId: client.client_id, phone: client.phone_number, countryCode: client.phone_country_code,
          eventType: 'new_year_campaign', referenceId: client.client_id, referenceType: 'client', scheduledAt,
          variables: { '1': client.full_name, '2': client.salon_name ?? 'our salon' },
          messagePreview: `Happy New Year, ${client.full_name}!`,
          isPreview: false,
        })
      }
    } catch (err: any) {
      logger.error('[WA-SCHED] seedNewYearRows error:', err?.message)
    }
  },

  // ── Reschedule / cancel in lockstep with the source entity ─────────────────

  async rescheduleForReference(referenceType: string, referenceId: string, eventType: AutomationEventType, newScheduledAt: Date | string): Promise<void> {
    await waScheduledMessagesRepository.rescheduleByReference(referenceType, referenceId, eventType, newScheduledAt)
  },

  async cancelForReference(referenceType: string, referenceId: string, eventType?: AutomationEventType): Promise<void> {
    await waScheduledMessagesRepository.cancelByReference(referenceType, referenceId, eventType)
  },

  // ── Row actions (API-driven) ────────────────────────────────────────────────

  // Claims synchronously (so the row leaves SCHEDULED before the response is
  // sent) but does NOT await the send itself — trigger()'s own retry loop can
  // sleep up to ~21 minutes across its 4 attempts (see sendWithRetry), which
  // blows past the frontend's 35s axios timeout. Awaiting it here would make
  // the request appear to "fail" while the backend keeps retrying in the
  // background, leaving the row stuck in SENDING with no way to re-trigger it
  // (claimById only accepts SCHEDULED/FAILED as a starting state).
  async sendNow(id: string, salonId: string): Promise<{ ok: boolean; reason?: string }> {
    const row = await waScheduledMessagesRepository.claimById(id, salonId, ['SCHEDULED'])
    if (!row) return { ok: false, reason: 'Row is not in a Scheduled state' }
    this.executeScheduledRow(row).catch(err =>
      logger.error('[WA-SCHED] sendNow executeScheduledRow failed', { id: row.id, error: err?.message }))
    return { ok: true }
  },

  async retryNow(id: string, salonId: string): Promise<{ ok: boolean; reason?: string }> {
    const row = await waScheduledMessagesRepository.claimById(id, salonId, ['FAILED'])
    if (!row) return { ok: false, reason: 'Row is not in a Failed state' }
    this.executeScheduledRow(row).catch(err =>
      logger.error('[WA-SCHED] retryNow executeScheduledRow failed', { id: row.id, error: err?.message }))
    return { ok: true }
  },

  async reschedule(id: string, salonId: string, scheduledAt: string): Promise<{ ok: boolean; reason?: string }> {
    const next = new Date(scheduledAt)
    if (isNaN(next.getTime()) || next.getTime() <= Date.now()) return { ok: false, reason: 'Scheduled time must be in the future' }
    const updated = await waScheduledMessagesRepository.rescheduleById(id, salonId, next)
    if (!updated) return { ok: false, reason: 'Row cannot be rescheduled from its current state' }
    return { ok: true }
  },

  async skip(id: string, salonId: string): Promise<{ ok: boolean; reason?: string }> {
    const row = await waScheduledMessagesRepository.findById(id, salonId)
    if (!row || row.status !== 'SCHEDULED') return { ok: false, reason: 'Only a Scheduled row can be skipped' }
    await waScheduledMessagesRepository.markSkipped(id, 'Skipped by staff')
    return { ok: true }
  },

  async cancel(id: string, salonId: string): Promise<{ ok: boolean; reason?: string }> {
    const row = await waScheduledMessagesRepository.findById(id, salonId)
    if (!row || !['SCHEDULED', 'FAILED'].includes(row.status)) return { ok: false, reason: 'Row cannot be cancelled from its current state' }
    await waScheduledMessagesRepository.markCancelled(id)
    return { ok: true }
  },

  // Clones a fresh row rather than mutating the SENT one, so history stays intact.
  async resend(id: string, salonId: string): Promise<{ ok: boolean; reason?: string }> {
    const row = await waScheduledMessagesRepository.findById(id, salonId)
    if (!row || row.status !== 'SENT') return { ok: false, reason: 'Only a Sent row can be resent' }
    const clone = await waScheduledMessagesRepository.upsertScheduled({
      salonId: row.salon_id, clientId: row.client_id, phone: row.phone_number, countryCode: row.phone_country_code,
      eventType: row.event_type,
      // Unique reference so this doesn't collide with (and silently no-op
      // against) the original row's own reference+event unique index.
      referenceId: `${row.id}-resend-${Date.now()}`, referenceType: 'resend',
      scheduledAt: new Date(), variables: row.variables, messagePreview: row.message_preview ?? '', isPreview: false,
    })
    const claimed = await waScheduledMessagesRepository.claimById(clone.id, salonId, ['SCHEDULED'])
    if (claimed) {
      this.executeScheduledRow(claimed).catch(err =>
        logger.error('[WA-SCHED] resend executeScheduledRow failed', { id: claimed.id, error: err?.message }))
    }
    return { ok: true }
  },

  // ── Shared executor ──────────────────────────────────────────────────────
  // row is already claimed (status='SENDING') by claimDue()/claimById() before this runs.
  async executeScheduledRow(row: ScheduledMessage): Promise<void> {
    // No dedupeByReference here, deliberately: that guard is a one-time-ever
    // key on (eventType, referenceId), but referenceId is this row's own id,
    // which never changes across Send Now / Retry Now / poller attempts on
    // the same row. Turning it on would let the FIRST real trigger() call
    // "use up" the guard forever, silently no-opping every later retry (it'd
    // read back the same stale old log instead of actually sending again).
    // Exactly-once is already guaranteed here by the atomic claim
    // (claimDue/claimById's UPDATE ... WHERE status = ... RETURNING) that
    // ran before this — only one caller can ever move a given row off
    // SCHEDULED/FAILED at a time.
    await whatsappAutomationService.trigger({
      salonId: row.salon_id, eventType: row.event_type, clientId: row.client_id,
      phone: row.phone_number, countryCode: row.phone_country_code,
      variables: row.variables, referenceId: row.id, referenceType: 'scheduled_message',
    })

    // trigger() never throws or reports outcome — read back the log it just
    // wrote (keyed by the same referenceId/referenceType just passed in).
    const log = await whatsappAutomationRepository.findLatestByReference(row.id, 'scheduled_message')
    if (log?.status === 'SENT' || log?.status === 'DELIVERED' || log?.status === 'READ') {
      await waScheduledMessagesRepository.markSent(row.id, log.id)
    } else if (log) {
      await waScheduledMessagesRepository.markFailed(row.id, log.failure_reason ?? 'Send failed')
    } else {
      await waScheduledMessagesRepository.markSkipped(row.id, 'No approved template, WhatsApp not configured, or client opted out')
    }

    // Birthday self-perpetuates: on a successful send, schedule next year's
    // occurrence for the same client so it recurs without a broad daily scan.
    if (row.event_type === 'birthday_wishes' && log?.status && ['SENT', 'DELIVERED', 'READ'].includes(log.status) && row.client_id) {
      // birthday_day_month itself isn't carried on this row (variables hold
      // the rendered message values, not raw source data) — re-derive next
      // year's date directly from this row's own scheduled_at, which already
      // encodes the correct month/day.
      const nextYear = new Date(row.scheduled_at)
      nextYear.setFullYear(nextYear.getFullYear() + 1)
      await waScheduledMessagesRepository.upsertScheduled({
        salonId: row.salon_id, clientId: row.client_id, phone: row.phone_number, countryCode: row.phone_country_code,
        eventType: 'birthday_wishes', referenceId: row.client_id, referenceType: 'client',
        scheduledAt: nextYear, variables: row.variables, messagePreview: row.message_preview ?? '', isPreview: false,
      })
    }
  },

  // ── Poller entry point ──────────────────────────────────────────────────
  async runDueTick(limit = 200): Promise<void> {
    const reaped = await waScheduledMessagesRepository.reapStaleSending()
    if (reaped > 0) logger.warn(`[WA-SCHED] Reaped ${reaped} stale SENDING row(s) back to FAILED`)

    const due = await waScheduledMessagesRepository.claimDue(limit)
    if (due.length === 0) return
    // Concurrent, not sequential — trigger()'s own retry loop can block for
    // up to ~21 minutes on a failing send (see sendWithRetry's backoff
    // schedule), so awaiting these one at a time in a for-loop could stall
    // an entire tick for a very long time on just a few bad sends.
    await Promise.allSettled(
      due.map(row => this.executeScheduledRow(row).catch(err =>
        logger.error('[WA-SCHED] executeScheduledRow failed', { id: row.id, error: err?.message })
      ))
    )
  },
}
