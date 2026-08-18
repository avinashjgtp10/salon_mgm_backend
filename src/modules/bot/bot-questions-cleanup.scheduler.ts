// ============================================================
// SalonOx — Bot Question History Retention Scheduler
// ============================================================
// Deletes bot_questions rows older than 30 days so Super Admin's Question
// History stops showing them. Runs once a day — retention doesn't need a
// tight cadence like the no-show sweep.

import logger from '../../config/logger'
import { botQuestionsService } from './bot-questions.service'

let schedulerInterval: NodeJS.Timeout | null = null

async function runCleanup(): Promise<void> {
  const deleted = await botQuestionsService.runRetentionCleanup()
  if (deleted > 0) {
    logger.info(`[BOT-QUESTIONS-CLEANUP] Deleted ${deleted} question(s) older than 30 days`)
  }
}

export function startBotQuestionsCleanupScheduler(): void {
  if (schedulerInterval) return

  logger.info('[BOT-QUESTIONS-CLEANUP] ⏰ Started — running every 24 hours')

  runCleanup().catch(err =>
    logger.error('[BOT-QUESTIONS-CLEANUP] Initial run error:', err?.message)
  )

  schedulerInterval = setInterval(() => {
    runCleanup().catch(err =>
      logger.error('[BOT-QUESTIONS-CLEANUP] Job error:', err?.message)
    )
  }, 24 * 60 * 60 * 1000)
}

export function stopBotQuestionsCleanupScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('[BOT-QUESTIONS-CLEANUP] ⏰ Stopped')
  }
}
