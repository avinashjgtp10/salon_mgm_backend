"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhooksService = void 0;
const database_1 = __importDefault(require("../../../../config/database"));
exports.webhooksService = {
    async verify(salonId, mode, token, challenge) {
        const { rows } = await database_1.default.query(`SELECT webhook_verify_token FROM whatsapp_configs WHERE salon_id=$1`, [salonId]);
        if (!rows[0])
            throw { statusCode: 400, message: 'Not configured' };
        if (mode === 'subscribe' && token === rows[0].webhook_verify_token)
            return challenge;
        throw { statusCode: 403, message: 'Verification failed' };
    },
    async handleWebhook(body) {
        const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
        if (statuses?.length) {
            for (const status of statuses)
                await this.processStatus(status);
        }
    },
    async processStatus(status) {
        const wamid = status.id;
        if (!wamid)
            return;
        const type = status.status?.toUpperCase();
        const timestamp = new Date(parseInt(status.timestamp) * 1000);
        const errorCode = status.errors?.[0]?.code?.toString();
        const errorTitle = status.errors?.[0]?.title;
        const { rows } = await database_1.default.query(`SELECT id, campaign_id FROM wa_campaign_contacts WHERE wamid=$1`, [wamid]);
        const contact = rows[0];
        if (!contact)
            return;
        if (type === 'DELIVERED') {
            await database_1.default.query(`UPDATE wa_campaign_contacts SET status='DELIVERED', delivered_at=$1 WHERE wamid=$2`, [timestamp, wamid]);
        }
        else if (type === 'READ') {
            await database_1.default.query(`UPDATE wa_campaign_contacts SET status='READ', read_at=$1 WHERE wamid=$2`, [timestamp, wamid]);
        }
        else if (type === 'FAILED') {
            const isBlocked = [131047, 131026, 131051].includes(parseInt(errorCode || '0'));
            await database_1.default.query(`UPDATE wa_campaign_contacts SET status=$1, error_code=$2, error_message=$3 WHERE wamid=$4`, [isBlocked ? 'BLOCKED' : 'FAILED', errorCode, errorTitle, wamid]);
        }
        await this.refreshCounts(contact.campaign_id);
    },
    async refreshCounts(campaignId) {
        const { rows: [c] } = await database_1.default.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ')) as sent_count,
        COUNT(*) FILTER (WHERE status IN ('DELIVERED','READ'))        as delivered_count,
        COUNT(*) FILTER (WHERE status = 'READ')                       as read_count,
        COUNT(*) FILTER (WHERE status = 'FAILED')                     as failed_count,
        COUNT(*) FILTER (WHERE status = 'BLOCKED')                    as blocked_count,
        COUNT(*)                                                       as total
      FROM wa_campaign_contacts WHERE campaign_id=$1
    `, [campaignId]);
        const done = parseInt(c.sent_count) + parseInt(c.failed_count) + parseInt(c.blocked_count);
        const allDone = done >= parseInt(c.total);
        await database_1.default.query(`
      UPDATE wa_campaigns SET
        sent_count=$1, delivered_count=$2, read_count=$3, failed_count=$4, blocked_count=$5,
        ${allDone ? "status='COMPLETED', completed_at=NOW()," : ''} updated_at=NOW()
      WHERE id=$6
    `, [c.sent_count, c.delivered_count, c.read_count, c.failed_count, c.blocked_count, campaignId]);
    },
    async getRecentEvents(salonId, campaignId) {
        const params = [salonId];
        const campaignFilter = campaignId ? `AND cc.campaign_id=$2` : '';
        if (campaignId)
            params.push(campaignId);
        const { rows } = await database_1.default.query(`
      SELECT cc.id, cc.phone, cc.name, cc.status, cc.wamid,
             cc.sent_at, cc.delivered_at, cc.read_at, cc.updated_at, cc.campaign_id
      FROM wa_campaign_contacts cc JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE c.salon_id=$1 AND cc.status != 'PENDING' ${campaignFilter}
      ORDER BY cc.updated_at DESC LIMIT 50
    `, params);
        return rows;
    },
};
//# sourceMappingURL=webhooks.service.js.map