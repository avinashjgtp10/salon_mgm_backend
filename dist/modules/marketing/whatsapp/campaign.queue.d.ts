import { Queue } from 'bullmq';
import Redis from 'ioredis';
declare const redisConnection: Redis;
export type CampaignJobData = {
    campaignId: string;
    salonId: string;
    batchIndex: number;
    contactIds: string[];
};
export declare const campaignQueue: Queue<CampaignJobData, any, string, CampaignJobData, any, string>;
export { redisConnection };
//# sourceMappingURL=campaign.queue.d.ts.map