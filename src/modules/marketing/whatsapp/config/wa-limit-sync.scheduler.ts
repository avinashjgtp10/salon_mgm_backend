// ============================================================
// SalonOx — WhatsApp Daily-Limit Sync Scheduler
// Keeps each salon's daily_limit / quality_rating in step with
// Meta's own tier upgrades (e.g. 250 -> 1K -> 10K) without
// requiring the salon owner to click "Sync Limits" manually.
// ============================================================

import logger from '../../../../config/logger'
import { configRepository } from './config.repository'
import { configService } from './config.service'

let schedulerInterval: NodeJS.Timeout | null = null

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000 // every 6 hours

async function runLimitSync(): Promise<void> {
  logger.info('[WA-LIMIT-SYNC] Running daily limit sync for all verified salons...')
  const configs = await configRepository.findAllVerified()

  for (const config of configs) {
    try {
      await configService.syncLimitsForSalon(config.salon_id)
    } catch (err: any) {
      logger.warn(`[WA-LIMIT-SYNC] Failed for salon ${config.salon_id}: ${err?.message}`)
    }
  }
  logger.info(`[WA-LIMIT-SYNC] Done — checked ${configs.length} salon(s)`)
}

export function startWaLimitSyncScheduler(): void {
  if (schedulerInterval) return

  logger.info('[WA-LIMIT-SYNC] ⏰ Started — running every 6 hours')

  runLimitSync().catch(err =>
    logger.error('[WA-LIMIT-SYNC] Initial run error:', err?.message)
  )

  schedulerInterval = setInterval(() => {
    runLimitSync().catch(err =>
      logger.error('[WA-LIMIT-SYNC] Job error:', err?.message)
    )
  }, SYNC_INTERVAL_MS)
}

export function stopWaLimitSyncScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('[WA-LIMIT-SYNC] ⏰ Stopped')
  }
}
