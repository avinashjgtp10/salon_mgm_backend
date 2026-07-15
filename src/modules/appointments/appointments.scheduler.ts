// ============================================================
// SalonOx — Appointment No-Show Scheduler
// ============================================================
// Flips "booked" appointments (nothing paid, staff never marked them any
// other way) to "no-show" once their scheduled end time has passed.
// Deliberately excludes "partial" — a deposit-paid appointment that runs
// past its time stays "partial" until staff intervene manually.

import logger from '../../config/logger'
import { appointmentsRepository } from './appointments.repository'

let schedulerInterval: NodeJS.Timeout | null = null

async function runNoShowSweep(): Promise<void> {
  const flipped = await appointmentsRepository.markNoShowBatch()
  if (flipped.length > 0) {
    logger.info(`[NO-SHOW-SCHEDULER] Marked ${flipped.length} appointment(s) as no-show`)
  }
}

export function startNoShowScheduler(): void {
  if (schedulerInterval) return

  logger.info('[NO-SHOW-SCHEDULER] ⏰ Started — running every 10 minutes')

  // Run immediately on start — idempotent, the query itself is the dedup guard
  runNoShowSweep().catch(err =>
    logger.error('[NO-SHOW-SCHEDULER] Initial run error:', err?.message)
  )

  schedulerInterval = setInterval(() => {
    runNoShowSweep().catch(err =>
      logger.error('[NO-SHOW-SCHEDULER] Job error:', err?.message)
    )
  }, 10 * 60 * 1000)
}

export function stopNoShowScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('[NO-SHOW-SCHEDULER] ⏰ Stopped')
  }
}
