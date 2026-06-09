// ============================================================
// SalonOx — WhatsApp Automation Scheduler
// All times in IST (UTC+5:30)
// ============================================================

import logger from '../../config/logger'
import { whatsappAutomationService } from './whatsapp-automation.service'

let schedulerInterval: NodeJS.Timeout | null = null

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

async function runScheduledJobs(): Promise<void> {
  const hour   = getISTHour()
  const minute = getISTMinute()

  logger.info(`[WA-AUTO-SCHEDULER] Tick — IST ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`)

  // ── Every hour: Appointment Reminders ──────────────────────────────────────
  // Runs hourly — checks appointments in the 24h window
  await whatsappAutomationService.runAppointmentReminders()

  // ── 9:00 AM IST daily jobs ─────────────────────────────────────────────────
  if (hour === 9 && minute < 5) {
    const today = getTodayIST()
    if (lastRunDate['9am'] !== today) {
      lastRunDate['9am'] = today
      logger.info('[WA-AUTO-SCHEDULER] Running 9AM IST daily jobs...')
      await Promise.allSettled([
        whatsappAutomationService.runBirthdayWishes(),
        whatsappAutomationService.runMembershipRenewalReminders(),
        whatsappAutomationService.runWeMissYou(30),
        whatsappAutomationService.runWeMissYou(60),
        whatsappAutomationService.runWeMissYou(90),
        whatsappAutomationService.runNewYearCampaign(), // self-guards to Jan 1 only
      ])
    }
  }

  // ── 10:00 AM IST: Pending Payment Reminders ────────────────────────────────
  if (hour === 10 && minute < 5) {
    const today = getTodayIST()
    if (lastRunDate['10am'] !== today) {
      lastRunDate['10am'] = today
      logger.info('[WA-AUTO-SCHEDULER] Running 10AM IST payment reminder job...')
      await whatsappAutomationService.runPendingPaymentReminders()
    }
  }
}

export function startAutomationScheduler(): void {
  if (schedulerInterval) return

  logger.info('[WA-AUTO-SCHEDULER] ⏰ Started — running every 60 minutes')

  // Run immediately on start — idempotent, dedup guard prevents duplicates
  runScheduledJobs().catch(err =>
    logger.error('[WA-AUTO-SCHEDULER] Initial run error:', err?.message)
  )

  // Then every 60 minutes
  schedulerInterval = setInterval(() => {
    runScheduledJobs().catch(err =>
      logger.error('[WA-AUTO-SCHEDULER] Job error:', err?.message)
    )
  }, 60 * 60 * 1000)
}

export function stopAutomationScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('[WA-AUTO-SCHEDULER] ⏰ Stopped')
  }
}