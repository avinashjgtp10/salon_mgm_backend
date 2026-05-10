import { campaignsService } from '../campaigns/campaigns.service'
import logger from '../../../../config/logger'

let schedulerInterval: NodeJS.Timeout | null = null

export function startCampaignScheduler() {
  if (schedulerInterval) return

  logger.info('⏰ Campaign scheduler started — checking every 60s')

  // Run immediately on start to catch any missed campaigns
  campaignsService.runDueScheduledCampaigns().catch(err =>
    logger.error('Scheduler error:', err)
  )

  // Then run every 60 seconds
  schedulerInterval = setInterval(async () => {
    try {
      await campaignsService.runDueScheduledCampaigns()
    } catch (err: any) {
      logger.error('Campaign scheduler error:', err.message)
    }
  }, 60_000)
}

export function stopCampaignScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('⏰ Campaign scheduler stopped')
  }
}