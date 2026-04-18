"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignWorker = void 0;
const bullmq_1 = require("bullmq");
const database_1 = __importDefault(require("../../../../config/database"));
const campaign_queue_1 = require("./campaign.queue");
const whatsapp_api_1 = require("../shared/whatsapp.api");
exports.campaignWorker = new bullmq_1.Worker('wa-campaign-messages', async (job) => {
    const { campaignId, salonId, contactIds } = job.data;
    const { rows: [camp] } = await database_1.default.query(`SELECT status FROM wa_campaigns WHERE id = $1`, [campaignId]);
    if (!camp || camp.status === 'PAUSED')
        return;
    const { rows: [waConfig] } = await database_1.default.query(`SELECT * FROM whatsapp_configs WHERE salon_id = $1`, [salonId]);
    if (!waConfig)
        throw new Error(`WhatsApp not configured for salon ${salonId}`);
    const { rows: [campaign] } = await database_1.default.query(`
      SELECT c.*, t.name AS template_name, t.body_text,
             t.language, t.header_type, t.header_media_id
      FROM wa_campaigns c
      JOIN wa_templates t ON t.id = c.template_id
      WHERE c.id = $1
    `, [campaignId]);
    const { rows: contacts } = await database_1.default.query(`SELECT * FROM wa_campaign_contacts WHERE id = ANY($1::uuid[])`, [contactIds]);
    let sent = 0, failed = 0, blocked = 0;
    for (const contact of contacts) {
        try {
            const matches = campaign.body_text.match(/\{\{\d+\}\}/g) ?? [];
            const components = [];
            if (campaign.header_type &&
                campaign.header_type !== 'none' &&
                campaign.header_type !== 'text' &&
                campaign.header_media_id &&
                !campaign.header_media_id.startsWith('4:')) {
                const mt = campaign.header_type;
                components.push({
                    type: 'header',
                    parameters: [{ type: mt, [mt]: { id: campaign.header_media_id } }],
                });
            }
            if (matches.length > 0) {
                const variables = contact.variables ?? {};
                const params = matches.map((_, i) => ({
                    type: 'text',
                    text: String(variables[`var${i + 1}`] ||
                        variables[String(i + 1)] ||
                        (i === 0 && contact.name ? contact.name : null) ||
                        `Value${i + 1}`),
                }));
                components.push({ type: 'body', parameters: params });
            }
            const result = await whatsapp_api_1.whatsappMetaApi.sendTemplateMessage({
                phoneNumberId: waConfig.phone_number_id,
                accessToken: waConfig.access_token,
                to: contact.phone,
                templateName: campaign.template_name,
                language: campaign.language,
                components,
            });
            const wamid = result?.messages?.[0]?.id;
            await database_1.default.query(`UPDATE wa_campaign_contacts
           SET status='SENT', wamid=$1, sent_at=NOW(), updated_at=NOW()
           WHERE id=$2`, [wamid, contact.id]);
            sent++;
        }
        catch (err) {
            const errObj = err?.response?.data?.error ?? {};
            const code = errObj.code?.toString() ?? 'unknown';
            const msg = errObj.message ?? err.message ?? 'Unknown error';
            const isBlocked = [131047, 131026, 131051, 131049].includes(parseInt(code));
            await database_1.default.query(`UPDATE wa_campaign_contacts
           SET status=$1, error_code=$2, error_message=$3, updated_at=NOW()
           WHERE id=$4`, [isBlocked ? 'BLOCKED' : 'FAILED', code, msg, contact.id]);
            isBlocked ? blocked++ : failed++;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    await database_1.default.query(`
      UPDATE wa_campaigns SET
        sent_count    = sent_count    + $1,
        failed_count  = failed_count  + $2,
        blocked_count = blocked_count + $3,
        updated_at    = NOW()
      WHERE id = $4
    `, [sent, failed, blocked, campaignId]);
    const { rows: [counts] } = await database_1.default.query(`
      SELECT
        COUNT(*) FILTER (WHERE status != 'PENDING') AS done,
        COUNT(*)                                     AS total
      FROM wa_campaign_contacts WHERE campaign_id = $1
    `, [campaignId]);
    if (parseInt(counts.done) >= parseInt(counts.total)) {
        await database_1.default.query(`UPDATE wa_campaigns
         SET status='COMPLETED', completed_at=NOW(), updated_at=NOW()
         WHERE id=$1`, [campaignId]);
    }
}, { connection: campaign_queue_1.redisConnection, concurrency: 1 });
exports.campaignWorker.on('completed', j => console.log(`✅ WA Job ${j.id} completed`));
exports.campaignWorker.on('failed', (j, e) => console.error(`❌ WA Job ${j?.id} failed:`, e.message));
//# sourceMappingURL=campaign.processor.js.map