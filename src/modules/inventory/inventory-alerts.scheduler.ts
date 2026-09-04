// ============================================================
// SalonOx — Inventory Alerts Scheduler
// ============================================================
// Nightly sweep for the two time-based alert statuses (expiring_soon,
// expired) — these can newly trigger purely from the calendar advancing,
// with no stock mutation to hook. Low-stock/out-of-stock notifications
// instead fire synchronously from inventoryAlertsService.checkAndNotify()
// at every stock-mutation call site (sales, purchases, adjustments, audits,
// consumable usage) — see inventory-alerts.service.ts. Same
// once-on-boot-then-every-24h shape as expiry-write-off.scheduler.ts.

import logger from '../../config/logger'
import { inventoryAlertsService } from './inventory-alerts.service'

let schedulerInterval: NodeJS.Timeout | null = null

async function runSweep(): Promise<void> {
  await inventoryAlertsService.sweepExpiring()
}

export function startInventoryAlertsScheduler(): void {
  if (schedulerInterval) return

  logger.info('[INVENTORY-ALERTS] ⏰ Started — running every 24 hours')

  runSweep().catch(err =>
    logger.error('[INVENTORY-ALERTS] Initial run error:', err?.message)
  )

  schedulerInterval = setInterval(() => {
    runSweep().catch(err =>
      logger.error('[INVENTORY-ALERTS] Job error:', err?.message)
    )
  }, 24 * 60 * 60 * 1000)
}

export function stopInventoryAlertsScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('[INVENTORY-ALERTS] ⏰ Stopped')
  }
}
