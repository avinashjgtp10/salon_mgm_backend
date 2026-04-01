import { Queue } from 'bullmq';
import Redis from 'ioredis';
export declare const redisConnection: Redis;
export type CampaignJobData = {
    campaignId: string;
    salonId: string;
    batchIndex: number;
    contactIds: string[];
};
export declare const campaignQueue: Queue<CampaignJobData, any, string, CampaignJobData, any, string>;
//# sourceMappingURL=whatsapp.queue.d.ts.map