import { Queue } from 'bullmq'
import Redis from 'ioredis'

// Same REDIS_URL every other Redis client in this app uses (config/redis.ts) —
// this used to build its own connection from REDIS_HOST/REDIS_PORT/REDIS_PASSWORD,
// none of which this project ever sets (only REDIS_URL exists in .env), so on
// any environment where Redis isn't literally on localhost:6379 this connection
// silently pointed nowhere. That's why a campaign of even a handful of contacts
// could sit PENDING for minutes or fail outright on deployed environments while
// working fine locally (where Redis happens to be on localhost).
// maxRetriesPerRequest stays null — BullMQ's own requirement for its blocking
// commands, not something config/redis.ts needs.
export const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
})

redisConnection.on('error', (err) => {
  console.error('❌ Campaign queue Redis error:', err)
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
