// ============================================================
// SalonOx — Bot Question History Retention Scheduler
// ============================================================
// Deletes bot_questions rows whose last activity is older than the retention
// window (24 hours) so the Super Admin chat inbox clears itself. Runs hourly.

import logger from '../../config/logger'
import { botQuestionsService, RETENTION_HOURS } from './bot-questions.service'

let schedulerInterval: NodeJS.Timeout | null = null

async function runCleanup(): Promise<void> {
  const deleted = await botQuestionsService.runRetentionCleanup()
  if (deleted > 0) {
    logger.info(`[BOT-QUESTIONS-CLEANUP] Deleted ${deleted} question(s) older than ${RETENTION_HOURS} hours`)
  }
}

export function startBotQuestionsCleanupScheduler(): void {
  if (schedulerInterval) return

  logger.info('[BOT-QUESTIONS-CLEANUP] ⏰ Started — running every hour')

  runCleanup().catch(err =>
    logger.error('[BOT-QUESTIONS-CLEANUP] Initial run error:', err?.message)
  )

  schedulerInterval = setInterval(() => {
    runCleanup().catch(err =>
      logger.error('[BOT-QUESTIONS-CLEANUP] Job error:', err?.message)
    )
  }, 60 * 60 * 1000)
}

export function stopBotQuestionsCleanupScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('[BOT-QUESTIONS-CLEANUP] ⏰ Stopped')
  }
}
