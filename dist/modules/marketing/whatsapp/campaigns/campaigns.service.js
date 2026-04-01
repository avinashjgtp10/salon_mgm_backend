"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignsService = void 0;
const database_1 = __importDefault(require("../../../../config/database"));
const campaigns_repository_1 = require("./campaigns.repository");
const campaign_queue_1 = require("../campaign.queue");
function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size)
        chunks.push(arr.slice(i, i + size));
    return chunks;
}
exports.campaignsService = {
    async getAll(salonId) { return campaigns_repository_1.campaignsRepo.findAll(salonId); },
    async getById(id, salonId) {
        const c = await campaigns_repository_1.campaignsRepo.findById(id, salonId);
        if (!c)
            throw { statusCode: 404, message: 'Campaign not found' };
        return c;
    },
    async create(salonId, data) {
        const { rows: tmpl } = await database_1.default.query(`SELECT id FROM wa_templates WHERE id=$1 AND salon_id=$2 AND status='APPROVED'`, [data.templateId, salonId]);
        if (!tmpl[0])
            throw { statusCode: 400, message: 'Template not found or not approved' };
        const client = await database_1.default.connect();
        try {
            await client.query('BEGIN');
            const campaignId = await campaigns_repository_1.campaignsRepo.create(salonId, data.templateId, data.name, data.batchSize, data.contacts.length);
            await campaigns_repository_1.campaignsRepo.bulkInsertContacts(campaignId, data.contacts);
            await client.query('COMMIT');
            const ids = await campaigns_repository_1.campaignsRepo.getContactIds(campaignId);
            const batches = chunk(ids, data.batchSize);
            for (let i = 0; i < batches.length; i++) {
                await campaign_queue_1.campaignQueue.add('send-batch', { campaignId, salonId, batchIndex: i, contactIds: batches[i] }, { delay: i * 2000 });
            }
            return campaigns_repository_1.campaignsRepo.findById(campaignId, salonId);
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
        return campaigns_repository_1.campaignsRepo.updateStatus(id, 'PAUSED');
    },
    async resume(id, salonId) {
        const campaign = await this.getById(id, salonId);
        const pending = await campaigns_repository_1.campaignsRepo.getPendingContactIds(id);
        if (pending.length > 0) {
            const batches = chunk(pending, campaign.batch_size);
            for (let i = 0; i < batches.length; i++) {
                await campaign_queue_1.campaignQueue.add('send-batch', { campaignId: id, salonId, batchIndex: i, contactIds: batches[i] }, { delay: i * 2000 });
            }
        }
        return campaigns_repository_1.campaignsRepo.updateStatus(id, 'SENDING');
    },
    async getContacts(id, salonId, status) {
        await this.getById(id, salonId);
        return campaigns_repository_1.campaignsRepo.getContacts(id, status);
    },
    async getReport(id, salonId, type) {
        await this.getById(id, salonId);
        return campaigns_repository_1.campaignsRepo.getReport(id, type);
    },
};
//# sourceMappingURL=campaigns.service.js.map