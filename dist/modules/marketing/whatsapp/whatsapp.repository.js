"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.waUsersRepository = exports.waWebhooksRepository = exports.waDashboardRepository = exports.waCampaignsRepository = exports.waTemplatesRepository = exports.waConfigRepository = void 0;
const database_1 = __importDefault(require("../../../config/database"));
const uuid_1 = require("uuid");
// ─── Config ───────────────────────────────────────────────────────────────────
exports.waConfigRepository = {
    async findBySalonId(salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM whatsapp_configs WHERE salon_id = $1`, [salonId]);
        return rows[0] || null;
    },
    async upsert(salonId, body) {
        const { rows } = await database_1.default.query(`
      INSERT INTO whatsapp_configs
        (salon_id, phone_number_id, waba_id, access_token, webhook_verify_token, display_phone)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (salon_id) DO UPDATE SET
        phone_number_id      = EXCLUDED.phone_number_id,
        waba_id              = EXCLUDED.waba_id,
        access_token         = EXCLUDED.access_token,
        webhook_verify_token = EXCLUDED.webhook_verify_token,
        display_phone        = EXCLUDED.display_phone,
        updated_at           = NOW()
      RETURNING *
    `, [
            salonId,
            body.phone_number_id,
            body.waba_id,
            body.access_token,
            body.webhook_verify_token,
            body.display_phone ?? null,
        ]);
        return rows[0];
    },
    async setVerified(salonId, displayPhone, qualityRating, tier) {
        const { rows } = await database_1.default.query(`
      UPDATE whatsapp_configs
      SET is_verified    = true,
          display_phone  = $2,
          quality_rating = $3,
          messaging_tier = $4,
          updated_at     = NOW()
      WHERE salon_id = $1
      RETURNING *
    `, [salonId, displayPhone, qualityRating, tier]);
        return rows[0];
    },
};
// ─── Templates ────────────────────────────────────────────────────────────────
exports.waTemplatesRepository = {
    async findAll(salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM wa_templates WHERE salon_id = $1 ORDER BY created_at DESC`, [salonId]);
        return rows;
    },
    async findById(id, salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM wa_templates WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return rows[0] || null;
    },
    async create(salonId, body) {
        const { rows } = await database_1.default.query(`
      INSERT INTO wa_templates
        (salon_id, name, category, language, header_type, header_text,
         body_text, footer_text, buttons, meta_template_id, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
      RETURNING *
    `, [
            salonId,
            body.name,
            body.category,
            body.language,
            body.header_type,
            body.header_text ?? null,
            body.body_text,
            body.footer_text ?? null,
            JSON.stringify(body.buttons ?? []),
            body.meta_template_id ?? null,
            body.status ?? 'PENDING',
        ]);
        return rows[0];
    },
    async updateStatus(id, status, metaTemplateId, rejectionReason) {
        const { rows } = await database_1.default.query(`
      UPDATE wa_templates SET
        status           = $2,
        meta_template_id = COALESCE($3, meta_template_id),
        rejection_reason = $4,
        approved_at      = CASE WHEN $2 = 'APPROVED' THEN NOW() ELSE approved_at END,
        updated_at       = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, status, metaTemplateId ?? null, rejectionReason ?? null]);
        return rows[0];
    },
    async delete(id, salonId) {
        const result = await database_1.default.query(`DELETE FROM wa_templates WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return (result.rowCount ?? 0) > 0;
    },
};
// ─── Campaigns ────────────────────────────────────────────────────────────────
exports.waCampaignsRepository = {
    async findAll(salonId) {
        const { rows } = await database_1.default.query(`
      SELECT c.*, t.name AS template_name
      FROM wa_campaigns c
      JOIN wa_templates t ON t.id = c.template_id
      WHERE c.salon_id = $1
      ORDER BY c.created_at DESC
    `, [salonId]);
        return rows;
    },
    async findById(id, salonId) {
        const { rows } = await database_1.default.query(`
      SELECT c.*, t.name AS template_name, t.body_text AS template_body
      FROM wa_campaigns c
      JOIN wa_templates t ON t.id = c.template_id
      WHERE c.id = $1 AND c.salon_id = $2
    `, [id, salonId]);
        return rows[0] || null;
    },
    async create(salonId, templateId, name, batchSize, totalContacts) {
        const campaignId = (0, uuid_1.v4)();
        await database_1.default.query(`
      INSERT INTO wa_campaigns
        (id, salon_id, template_id, name, status, batch_size, total_contacts, started_at)
      VALUES ($1,$2,$3,$4,'SENDING',$5,$6,NOW())
    `, [campaignId, salonId, templateId, name, batchSize, totalContacts]);
        return campaignId;
    },
    async bulkInsertContacts(campaignId, contacts) {
        const CHUNK = 500;
        for (let i = 0; i < contacts.length; i += CHUNK) {
            const chunk = contacts.slice(i, i + CHUNK);
            const vals = chunk.map((_c, j) => {
                const b = j * 5;
                return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::jsonb)`;
            }).join(',');
            const params = chunk.flatMap(c => [
                (0, uuid_1.v4)(), campaignId, c.phone,
                c.name ?? null,
                JSON.stringify(c.variables ?? {}),
            ]);
            await database_1.default.query(`INSERT INTO wa_campaign_contacts (id, campaign_id, phone, name, variables) VALUES ${vals}`, params);
        }
    },
    async getContactIds(campaignId) {
        const { rows } = await database_1.default.query(`SELECT id FROM wa_campaign_contacts WHERE campaign_id = $1`, [campaignId]);
        return rows.map(r => r.id);
    },
    async getPendingContactIds(campaignId) {
        const { rows } = await database_1.default.query(`SELECT id FROM wa_campaign_contacts WHERE campaign_id = $1 AND status = 'PENDING'`, [campaignId]);
        return rows.map(r => r.id);
    },
    async updateStatus(id, status) {
        const { rows } = await database_1.default.query(`UPDATE wa_campaigns SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, status]);
        return rows[0];
    },
    async getContacts(campaignId, status) {
        const params = [campaignId];
        const statusFilter = status ? `AND status = $2` : '';
        if (status)
            params.push(status);
        const { rows } = await database_1.default.query(`
      SELECT * FROM wa_campaign_contacts
      WHERE campaign_id = $1 ${statusFilter}
      ORDER BY created_at ASC
    `, params);
        return rows;
    },
    async getReport(campaignId, type) {
        const statusMap = {
            successful: ['DELIVERED', 'READ'],
            failed: ['FAILED'],
            blocked: ['BLOCKED'],
        };
        const statuses = statusMap[type] ?? [];
        const { rows } = await database_1.default.query(`
      SELECT * FROM wa_campaign_contacts
      WHERE campaign_id = $1 AND status = ANY($2::text[])
    `, [campaignId, statuses]);
        return rows;
    },
};
// ─── Dashboard ────────────────────────────────────────────────────────────────
exports.waDashboardRepository = {
    async getStats(salonId) {
        const { rows: [stats] } = await database_1.default.query(`
      SELECT
        COUNT(DISTINCT c.id)                                           AS total_campaigns,
        COUNT(DISTINCT CASE WHEN c.status='SENDING' THEN c.id END)    AS active_campaigns,
        COALESCE(SUM(c.sent_count),0)                                  AS total_sent,
        COALESCE(SUM(c.delivered_count),0)                             AS total_delivered,
        COALESCE(SUM(c.read_count),0)                                  AS total_read,
        COALESCE(SUM(c.failed_count),0)                                AS total_failed,
        COALESCE(SUM(c.blocked_count),0)                               AS total_blocked,
        COALESCE(SUM(c.total_contacts),0)                              AS total_contacts
      FROM wa_campaigns c
      WHERE c.salon_id = $1
    `, [salonId]);
        return stats;
    },
    async getDailyVolume(salonId) {
        const { rows } = await database_1.default.query(`
      SELECT
        TO_CHAR(cc.sent_at, 'Mon DD') AS date,
        COUNT(*)                       AS count
      FROM wa_campaign_contacts cc
      JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE c.salon_id   = $1
        AND cc.sent_at  >= NOW() - INTERVAL '7 days'
        AND cc.status   != 'PENDING'
      GROUP BY TO_CHAR(cc.sent_at, 'Mon DD'), DATE(cc.sent_at)
      ORDER BY DATE(cc.sent_at) ASC
    `, [salonId]);
        return rows;
    },
};
// ─── Webhooks ─────────────────────────────────────────────────────────────────
exports.waWebhooksRepository = {
    async findContactByWamid(wamid) {
        const { rows } = await database_1.default.query(`SELECT id, campaign_id FROM wa_campaign_contacts WHERE wamid = $1`, [wamid]);
        return rows[0] || null;
    },
    async markDelivered(wamid, timestamp) {
        await database_1.default.query(`UPDATE wa_campaign_contacts SET status='DELIVERED', delivered_at=$1, updated_at=NOW() WHERE wamid=$2`, [timestamp, wamid]);
    },
    async markRead(wamid, timestamp) {
        await database_1.default.query(`UPDATE wa_campaign_contacts SET status='READ', read_at=$1, updated_at=NOW() WHERE wamid=$2`, [timestamp, wamid]);
    },
    async markFailed(wamid, status, errorCode, errorMessage) {
        await database_1.default.query(`UPDATE wa_campaign_contacts SET status=$1, error_code=$2, error_message=$3, updated_at=NOW() WHERE wamid=$4`, [status, errorCode, errorMessage, wamid]);
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
        cc.sent_at, cc.delivered_at, cc.read_at, cc.updated_at,
        cc.campaign_id, c.name AS campaign_name
      FROM wa_campaign_contacts cc
      JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE c.salon_id  = $1
        AND cc.status  != 'PENDING'
        ${campaignFilter}
      ORDER BY cc.updated_at DESC
      LIMIT 50
    `, params);
        return rows;
    },
};
// ─── Users (WA scoped) ────────────────────────────────────────────────────────
exports.waUsersRepository = {
    async findBySalonId(salonId) {
        const { rows } = await database_1.default.query(`
      SELECT id, first_name, last_name, email, role, is_active, created_at
      FROM users
      WHERE salon_id = $1
      ORDER BY created_at DESC
    `, [salonId]);
        return rows;
    },
    async create(salonId, data) {
        const { rows } = await database_1.default.query(`
      INSERT INTO users (id, salon_id, first_name, last_name, email, password_hash, role, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true)
      RETURNING id, first_name, last_name, email, role, is_active, created_at
    `, [(0, uuid_1.v4)(), salonId, data.first_name, data.last_name, data.email, data.password_hash, data.role]);
        return rows[0];
    },
    async delete(id, salonId) {
        const result = await database_1.default.query(`DELETE FROM users WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return (result.rowCount ?? 0) > 0;
    },
};
//# sourceMappingURL=whatsapp.repository.js.map