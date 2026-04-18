"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhooksService = void 0;
const error_middleware_1 = require("../../../../middleware/error.middleware");
const webhooks_repository_1 = require("./webhooks.repository");
exports.webhooksService = {
    async verify(salonId, mode, token, challenge) {
        const verifyToken = await webhooks_repository_1.webhooksRepository.findVerifyToken(salonId);
        if (!verifyToken)
            throw new error_middleware_1.AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED');
        if (mode === 'subscribe' && token === verifyToken)
            return challenge;
        throw new error_middleware_1.AppError(403, 'Webhook verification failed', 'WEBHOOK_VERIFY_FAILED');
    },
    async handleWebhook(body) {
        const entry = body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const statuses = value?.statuses;
        if (statuses?.length) {
            for (const status of statuses) {
                await this.processStatus(status);
            }
        }
    },
    async processStatus(status) {
        const wamid = status.id;
        if (!wamid)
            return;
        const type = status.status?.toUpperCase();
        const timestamp = new Date(parseInt(status.timestamp) * 1000);
        const errorCode = status.errors?.[0]?.code?.toString() ?? null;
        const errorMsg = status.errors?.[0]?.title ?? null;
        const contact = await webhooks_repository_1.webhooksRepository.findContactByWamid(wamid);
        if (!contact)
            return;
        if (type === 'DELIVERED') {
            await webhooks_repository_1.webhooksRepository.markDelivered(wamid, timestamp);
        }
        else if (type === 'READ') {
            await webhooks_repository_1.webhooksRepository.markRead(wamid, timestamp);
        }
        else if (type === 'FAILED') {
            const isBlocked = [131047, 131026, 131051].includes(parseInt(errorCode ?? '0'));
            await webhooks_repository_1.webhooksRepository.markFailed(wamid, isBlocked ? 'BLOCKED' : 'FAILED', errorCode, errorMsg);
        }
        await webhooks_repository_1.webhooksRepository.refreshCampaignCounts(contact.campaign_id);
    },
    async getRecentEvents(salonId, campaignId) {
        return webhooks_repository_1.webhooksRepository.getRecentEvents(salonId, campaignId);
    },
};
//# sourceMappingURL=webhooks.service.js.map