"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignsService = void 0;
const database_1 = __importDefault(require("../../../../config/database"));
const error_middleware_1 = require("../../../../middleware/error.middleware");
const campaigns_repository_1 = require("./campaigns.repository");
const campaign_queue_1 = require("../queue/campaign.queue");
function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size)
        chunks.push(arr.slice(i, i + size));
    return chunks;
}
exports.campaignsService = {
    async getAll(salonId) {
        return campaigns_repository_1.campaignsRepository.findAll(salonId);
    },
    async getById(id, salonId) {
        const c = await campaigns_repository_1.campaignsRepository.findById(id, salonId);
        if (!c)
            throw new error_middleware_1.AppError(404, 'Campaign not found', 'NOT_FOUND');
        return c;
    },
    async create(salonId, body) {
        const { rows: tmpl } = await database_1.default.query(`SELECT id FROM wa_templates
       WHERE id = $1 AND salon_id = $2 AND status = 'APPROVED'`, [body.template_id, salonId]);
        if (!tmpl[0])
            throw new error_middleware_1.AppError(400, 'Template not found or not approved', 'TEMPLATE_NOT_APPROVED');
        const batchSize = body.batch_size ?? 50;
        const client = await database_1.default.connect();
        try {
            await client.query('BEGIN');
            const campaignId = await campaigns_repository_1.campaignsRepository.create(salonId, body.template_id, body.name, batchSize, body.contacts.length);
            await campaigns_repository_1.campaignsRepository.bulkInsertContacts(campaignId, body.contacts);
            await client.query('COMMIT');
            const ids = await campaigns_repository_1.campaignsRepository.getContactIds(campaignId);
            const batches = chunk(ids, batchSize);
            for (let i = 0; i < batches.length; i++) {
                await campaign_queue_1.campaignQueue.add('send-batch', {
                    campaignId, salonId,
                    batchIndex: i,
                    contactIds: batches[i],
                }, { delay: i * 2000 });
            }
            return campaigns_repository_1.campaignsRepository.findById(campaignId, salonId);
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    },
    async pause(id, salonId) {
        await this.getById(id, salonId);
        return campaigns_repository_1.campaignsRepository.updateStatus(id, 'PAUSED');
    },
    async resume(id, salonId) {
        const campaign = await this.getById(id, salonId);
        const pending = await campaigns_repository_1.campaignsRepository.getPendingContactIds(id);
        if (pending.length > 0) {
            const batches = chunk(pending, campaign.batch_size);
            for (let i = 0; i < batches.length; i++) {
                await campaign_queue_1.campaignQueue.add('send-batch', {
                    campaignId: id, salonId,
                    batchIndex: i,
                    contactIds: batches[i],
                }, { delay: i * 2000 });
            }
        }
        return campaigns_repository_1.campaignsRepository.updateStatus(id, 'SENDING');
    },
    async getContacts(id, salonId, status) {
        await this.getById(id, salonId);
        return campaigns_repository_1.campaignsRepository.getContacts(id, status);
    },
    async getReport(id, salonId, type) {
        await this.getById(id, salonId);
        return campaigns_repository_1.campaignsRepository.getReport(id, type);
    },
};
//# sourceMappingURL=campaigns.service.js.map