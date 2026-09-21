// ============================================================
// SalonOx — Salon Deactivation Reminder Scheduler
// ============================================================
// Daily 8am IST reminder email to every salon currently deactivated
// (salons.is_active = false) — separate from the one-off email
// super-admin.service.ts::setSalonStatus sends the moment a salon is first
// deactivated; this one keeps nudging as long as it stays deactivated.
// Fixed-wall-clock-time shape (setTimeout to the next 8am, then repeat every
// 24h) rather than the once-on-boot-then-every-24h shape most other
// schedulers use (inventory-alerts.scheduler.ts etc.) — those don't care
// what time of day they run, this one specifically needs to be 8am.

import logger from '../../config/logger'
import { superAdminRepository } from './super-admin.repository'
import { emailService } from '../utils/email.service'

let timer: NodeJS.Timeout | null = null

function msUntilNextIST8AM(): number {
  const nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const target = new Date(nowIst)
  target.setHours(8, 0, 0, 0)
  if (target <= nowIst) target.setDate(target.getDate() + 1)
  return target.getTime() - nowIst.getTime()
}

async function runReminderSweep(): Promise<void> {
  const salons = await superAdminRepository.getAllInactiveSalonsWithOwner()
  for (const salon of salons) {
    if (!salon.owner_email) continue
    try {
      await emailService.sendSalonDeactivatedEmail({
        to: salon.owner_email,
        salonName: salon.name,
        ownerName: salon.owner_name,
      })
    } catch (err: any) {
      logger.error('[SALON-DEACTIVATION-REMINDER] Send failed:', { salonId: salon.id, error: err?.message })
    }
  }
  logger.info(`[SALON-DEACTIVATION-REMINDER] Sweep complete — ${salons.length} inactive salon(s)`)
}

export function startSalonDeactivationReminderScheduler(): void {
  if (timer) return

  const delay = msUntilNextIST8AM()
  logger.info(`[SALON-DEACTIVATION-REMINDER] ⏰ Scheduled — next run in ${Math.round(delay / 60000)} min, then every 24h at 8am IST`)

  timer = setTimeout(function run() {
    runReminderSweep().catch(err =>
      logger.error('[SALON-DEACTIVATION-REMINDER] Job error:', err?.message)
    )
    timer = setInterval(() => {
      runReminderSweep().catch(err =>
        logger.error('[SALON-DEACTIVATION-REMINDER] Job error:', err?.message)
      )
    }, 24 * 60 * 60 * 1000)
  }, delay)
}

export function stopSalonDeactivationReminderScheduler(): void {
  if (timer) {
    clearTimeout(timer as NodeJS.Timeout)
    clearInterval(timer as NodeJS.Timeout)
    timer = null
    logger.info('[SALON-DEACTIVATION-REMINDER] ⏰ Stopped')
  }
}
