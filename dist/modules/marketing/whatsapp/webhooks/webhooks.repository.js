"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhooksRepository = void 0;
const database_1 = __importDefault(require("../../../../config/database"));
exports.webhooksRepository = {
    async findVerifyToken(salonId) {
        const { rows } = await database_1.default.query(`SELECT webhook_verify_token FROM whatsapp_configs WHERE salon_id = $1`, [salonId]);
        return rows[0]?.webhook_verify_token ?? null;
    },
    async findContactByWamid(wamid) {
        const { rows } = await database_1.default.query(`SELECT id, campaign_id FROM wa_campaign_contacts WHERE wamid = $1`, [wamid]);
        return rows[0] || null;
    },
    async markDelivered(wamid, timestamp) {
        await database_1.default.query(`UPDATE wa_campaign_contacts
       SET status='DELIVERED', delivered_at=$1, updated_at=NOW()
       WHERE wamid=$2`, [timestamp, wamid]);
    },
    async markRead(wamid, timestamp) {
        await database_1.default.query(`UPDATE wa_campaign_contacts
       SET status='READ', read_at=$1, updated_at=NOW()
       WHERE wamid=$2`, [timestamp, wamid]);
    },
    async markFailed(wamid, status, errorCode, errorMessage) {
        await database_1.default.query(`UPDATE wa_campaign_contacts
       SET status=$1, error_code=$2, error_message=$3, updated_at=NOW()
       WHERE wamid=$4`, [status, errorCode, errorMessage, wamid]);
    },
    async refreshCampaignCounts(campaignId) {
        const { rows: [c] } = await database_1.default.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ')) AS sent_count,
        COUNT(*) FILTER (WHERE status IN ('DELIVERED','READ'))        AS delivered_count,
        COUNT(*) FILTER (WHERE status = 'READ')                       AS read_count,
        COUNT(*) FILTER (WHERE status = 'FAILED')                     AS failed_count,
        COUNT(*) FILTER (WHERE status = 'BLOCKED')                    AS blocked_count,
        COUNT(*)                                                       AS total
      FROM wa_campaign_contacts WHERE campaign_id = $1
    `, [campaignId]);
        const done = parseInt(c.sent_count) + parseInt(c.failed_count) + parseInt(c.blocked_count);
        const allDone = done >= parseInt(c.total);
        await database_1.default.query(`
      UPDATE wa_campaigns SET
        sent_count      = $1,
        delivered_count = $2,
        read_count      = $3,
        failed_count    = $4,
        blocked_count   = $5,
        ${allDone ? "status = 'COMPLETED', completed_at = NOW()," : ''}
        updated_at      = NOW()
      WHERE id = $6
    `, [c.sent_count, c.delivered_count, c.read_count, c.failed_count, c.blocked_count, campaignId]);
    },
    async getRecentEvents(salonId, campaignId) {
        const params = [salonId];
        const campaignFilter = campaignId ? `AND cc.campaign_id = $2` : '';
        if (campaignId)
            params.push(campaignId);
        const { rows } = await database_1.default.query(`
      SELECT
        cc.id, cc.phone, cc.name, cc.status, cc.wamid,
        cc.campaign_id, c.name AS campaign_name,
        cc.sent_at, cc.delivered_at, cc.read_at, cc.updated_at
      FROM wa_campaign_contacts cc
      JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE c.salon_id = $1
        AND cc.status != 'PENDING'
        ${campaignFilter}
      ORDER BY cc.updated_at DESC
      LIMIT 50
    `, params);
        return rows;
    },
};
//# sourceMappingURL=webhooks.repository.js.map