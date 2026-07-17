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
  // Without this, BullMQ's default is attempts: 1 — a single transient DB
  // blip (see campaign.processor.ts's unprotected top-of-job queries) meant
  // one failed batch of 50 contacts was stuck PENDING forever, with nothing
  // to ever retry it. 3 attempts with exponential backoff rides out the kind
  // of momentary connection-pool contention this worker is prone to under load.
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
})
