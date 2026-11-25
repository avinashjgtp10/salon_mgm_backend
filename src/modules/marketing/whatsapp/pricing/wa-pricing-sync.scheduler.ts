import logger from '../../../../config/logger'
import { syncPricingIfDue } from './pricing.sync.service'

// Keeps the stored copy of Meta's WhatsApp price list current. Meta changes prices only on the 1st of Jan / Apr / Jul / Oct,
// so checking twice a day is plenty; the work is skipped when the stored list is under ~20 hours old.
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000
const FIRST_RUN_DELAY_MS = 90_000     // let the server finish starting first

let timer: NodeJS.Timeout | null = null
let firstRun: NodeJS.Timeout | null = null

const check = () => {
  syncPricingIfDue()
    .then((r) => { if (r.skipped === 'not_migrated') logger.debug?.('[wa-pricing] price tables not created yet (Migration/create_wa_pricing.sql) - skipping') })
    .catch((err) => logger.warn('[wa-pricing] scheduled check failed', { error: err?.message }))
}

export function startWaPricingSyncScheduler(): void {
  if (timer) return
  firstRun = setTimeout(check, FIRST_RUN_DELAY_MS)
  timer = setInterval(check, CHECK_EVERY_MS)
}

export function stopWaPricingSyncScheduler(): void {
  if (firstRun) clearTimeout(firstRun)
  if (timer) clearInterval(timer)
  firstRun = null
  timer = null
}
