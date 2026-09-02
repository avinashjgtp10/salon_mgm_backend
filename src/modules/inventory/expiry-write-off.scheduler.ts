// ============================================================
// SalonOx — Expired Stock Write-Off Scheduler
// ============================================================
// Nightly sweep: for any retail product whose ENTIRE current stock has
// expired (every purchase batch's expiry_date has passed — see
// stockLedgerRepository.findFullyExpiredProducts for why "entire", not
// "any"), writes off the full remaining amount as a stock_ledger 'expired'
// row and zeroes products.amount. Idempotent by construction: a product
// already at amount=0 no longer matches the finder's `amount > 0` filter,
// so re-running the sweep never double-writes-off the same stock.

import logger from '../../config/logger'
import { stockLedgerRepository } from './stock-ledger.repository'
import { appointmentConsumablesService } from './inventory.service'

let schedulerInterval: NodeJS.Timeout | null = null

async function runExpiryWriteOffSweep(): Promise<void> {
  const candidates = await stockLedgerRepository.findFullyExpiredProducts()
  if (!candidates.length) return

  let written = 0
  for (const product of candidates) {
    try {
      const branchId = await appointmentConsumablesService.resolveBranchId(product.salon_id, null)
      if (!branchId) {
        logger.warn('[EXPIRY-WRITE-OFF] no branch resolvable, skipping product', { productId: product.id, salonId: product.salon_id })
        continue
      }
      await stockLedgerRepository.writeOffExpiredProduct({
        salonId: product.salon_id,
        branchId,
        productId: product.id,
        amount: product.amount,
      })
      written++
    } catch (err: any) {
      logger.error('[EXPIRY-WRITE-OFF] failed to write off product', { productId: product.id, message: err?.message })
    }
  }

  if (written > 0) {
    logger.info(`[EXPIRY-WRITE-OFF] Wrote off ${written} fully-expired product(s)`)
  }
}

export function startExpiryWriteOffScheduler(): void {
  if (schedulerInterval) return

  logger.info('[EXPIRY-WRITE-OFF] ⏰ Started — running every 24 hours')

  // Run once on start (idempotent — see module header), then daily.
  runExpiryWriteOffSweep().catch(err =>
    logger.error('[EXPIRY-WRITE-OFF] Initial run error:', err?.message)
  )

  schedulerInterval = setInterval(() => {
    runExpiryWriteOffSweep().catch(err =>
      logger.error('[EXPIRY-WRITE-OFF] Job error:', err?.message)
    )
  }, 24 * 60 * 60 * 1000)
}

export function stopExpiryWriteOffScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('[EXPIRY-WRITE-OFF] ⏰ Stopped')
  }
}
