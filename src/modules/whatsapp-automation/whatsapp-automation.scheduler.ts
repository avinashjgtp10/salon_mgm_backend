// ============================================================
// SalonOx — WhatsApp Automation Scheduler
// All times in IST (UTC+5:30)
// ============================================================

import logger from '../../config/logger'
import { whatsappAutomationService } from './whatsapp-automation.service'

let schedulerInterval: NodeJS.Timeout | null = null

// Get current hour in IST
function getISTHour(): number {
  return parseInt(
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false })
  )
}

// Get current minute in IST
function getISTMinute(): number {
  return parseInt(
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', minute: '2-digit' })
  )
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

  // ── 10:00 AM IST: Pending Payment Reminders ────────────────────────────────
  if (hour === 10 && minute < 5) {
    logger.info('[WA-AUTO-SCHEDULER] Running 10AM IST payment reminder job...')
    await whatsappAutomationService.runPendingPaymentReminders()
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