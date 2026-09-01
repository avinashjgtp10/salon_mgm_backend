// ============================================================
// SalonOx — WhatsApp Automation Scheduler
// All times in IST (UTC+5:30)
// ============================================================

import logger from '../../config/logger'
import { waScheduledMessagesService } from './wa-scheduled-messages.service'

let schedulerInterval: NodeJS.Timeout | null = null
let dueTickInterval: NodeJS.Timeout | null = null

// Track last run date per job group to prevent duplicate runs within same day
const lastRunDate: Record<string, string> = {}

// Get current hour in IST — safe with NaN fallback
function getISTHour(): number {
  try {
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date())
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '')
    if (!Number.isFinite(h)) throw new Error('NaN hour')
    return h
  } catch (err) {
    logger.error('[WA-AUTO-SCHEDULER] getISTHour failed, defaulting to -1', err)
    return -1
  }
}

// Get current minute in IST — safe with NaN fallback
function getISTMinute(): number {
  try {
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      minute: '2-digit',
    }).formatToParts(new Date())
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '')
    if (!Number.isFinite(m)) throw new Error('NaN minute')
    return m
  } catch (err) {
    logger.error('[WA-AUTO-SCHEDULER] getISTMinute failed, defaulting to 99', err)
    return 99
  }
}

// Get today's date string in IST (YYYY-MM-DD)
function getTodayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

// Package/membership expiry, appointment reminders, and birthday wishes are
// no longer computed here at all — they're scheduled as real
// wa_scheduled_messages rows ahead of time, right when their source entity
// (a package, a membership, an appointment, a client) is created — see
// wa-scheduled-messages.service.ts's scheduleXxx() methods, called from
// client-packages/client-memberships/appointments/clients .service.ts. This
// tick's only remaining job is Group B's 1-day rolling preview (pending
// payment / we-miss-you — condition-based, no fixed date to commit to ahead
// of time) plus the New Year per-client seed.
async function runScheduledJobs(): Promise<void> {
  const hour   = getISTHour()
  const minute = getISTMinute()

  logger.info(`[WA-AUTO-SCHEDULER] Tick — IST ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`)

  // ── 9:00 AM IST daily jobs ─────────────────────────────────────────────────
  if (hour === 9 && minute < 5) {
    const today = getTodayIST()
    if (lastRunDate['9am'] !== today) {
      lastRunDate['9am'] = today
      logger.info('[WA-AUTO-SCHEDULER] Running 9AM IST daily jobs...')
      await Promise.allSettled([
        waScheduledMessagesService.upsertGroupBPreview('we_miss_you_30d'),
        waScheduledMessagesService.upsertGroupBPreview('we_miss_you_60d'),
        waScheduledMessagesService.upsertGroupBPreview('we_miss_you_90d'),
        waScheduledMessagesService.seedNewYearRows(), // self-guards to December only
      ])
    }
  }

  // ── 10:00 AM IST: Pending Payment Reminders (rolling preview) ─────────────
  if (hour === 10 && minute < 5) {
    const today = getTodayIST()
    if (lastRunDate['10am'] !== today) {
      lastRunDate['10am'] = today
      logger.info('[WA-AUTO-SCHEDULER] Running 10AM IST payment reminder preview job...')
      await waScheduledMessagesService.upsertGroupBPreview('pending_payment_reminder')
    }
  }
}

export function startAutomationScheduler(): void {
  if (schedulerInterval) return

  logger.info('[WA-AUTO-SCHEDULER] ⏰ Started — 60min daily-job poll + 5min due-message poll')

  // Run immediately on start — idempotent, dedup guard prevents duplicates
  runScheduledJobs().catch(err =>
    logger.error('[WA-AUTO-SCHEDULER] Initial run error:', err?.message)
  )
  waScheduledMessagesService.runDueTick().catch(err =>
    logger.error('[WA-AUTO-SCHEDULER] Initial due-tick error:', err?.message)
  )

  // Daily-job poll — unchanged cadence, only Group B/New Year left in it now.
  schedulerInterval = setInterval(() => {
    runScheduledJobs().catch(err =>
      logger.error('[WA-AUTO-SCHEDULER] Job error:', err?.message)
    )
  }, 60 * 60 * 1000)

  // Due-message poll — tighter cadence (mirrors the campaign scheduler's own
  // 60s poll for a different piece of state), so a row scheduled for e.g.
  // 10:00 AM actually sends close to 10:00, not up to an hour late.
  dueTickInterval = setInterval(() => {
    waScheduledMessagesService.runDueTick().catch(err =>
      logger.error('[WA-AUTO-SCHEDULER] Due-tick error:', err?.message)
    )
  }, 5 * 60 * 1000)
}

export function stopAutomationScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
  if (dueTickInterval) {
    clearInterval(dueTickInterval)
    dueTickInterval = null
  }
  logger.info('[WA-AUTO-SCHEDULER] ⏰ Stopped')
}
