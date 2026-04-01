import { Queue } from 'bullmq'
import Redis from 'ioredis'

export const redisConnection = new Redis({
  host:                 process.env.REDIS_HOST     ?? 'localhost',
  port:                 parseInt(process.env.REDIS_PORT ?? '6379'),
  password:             process.env.REDIS_PASSWORD  ?? undefined,
  maxRetriesPerRequest: null,
})

export type CampaignJobData = {
  campaignId: string
  salonId:    string
  batchIndex: number
  contactIds: string[]
}

export const campaignQueue = new Queue<CampaignJobData>('wa-campaign-messages', {
  connection: redisConnection,
})
