"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardRepo = void 0;
const database_1 = __importDefault(require("../../../../config/database"));
exports.dashboardRepo = {
    async getStats(salonId) {
        const { rows: [stats] } = await database_1.default.query(`
      SELECT
        COUNT(DISTINCT c.id)                                        as total_campaigns,
        COUNT(DISTINCT CASE WHEN c.status = 'SENDING' THEN c.id END) as active_campaigns,
        COALESCE(SUM(c.sent_count), 0)                              as total_sent,
        COALESCE(SUM(c.delivered_count), 0)                         as total_delivered,
        COALESCE(SUM(c.read_count), 0)                              as total_read,
        COALESCE(SUM(c.failed_count), 0)                            as total_failed,
        COALESCE(SUM(c.blocked_count), 0)                           as total_blocked,
        COALESCE(SUM(c.total_contacts), 0)                          as total_contacts
      FROM wa_campaigns c WHERE c.salon_id = $1
    `, [salonId]);
        return stats;
    },
    async getDailyVolume(salonId) {
        const { rows } = await database_1.default.query(`
      SELECT TO_CHAR(cc.sent_at, 'Mon DD') as date, COUNT(*) as count
      FROM wa_campaign_contacts cc JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE c.salon_id=$1 AND cc.sent_at >= NOW() - INTERVAL '7 days' AND cc.status != 'PENDING'
      GROUP BY TO_CHAR(cc.sent_at, 'Mon DD'), DATE(cc.sent_at) ORDER BY DATE(cc.sent_at) ASC
    `, [salonId]);
        return rows;
    },
    async getWAConfig(salonId) {
        const { rows } = await database_1.default.query(`SELECT display_phone, is_verified, quality_rating, messaging_tier, daily_limit FROM whatsapp_configs WHERE salon_id=$1`, [salonId]);
        return rows[0] || null;
    },
};
//# sourceMappingURL=dashboard.repository.js.map