"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.templatesRepo = void 0;
const database_1 = __importDefault(require("../../../../config/database"));
exports.templatesRepo = {
    async findAll(salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM wa_templates WHERE salon_id = $1 ORDER BY created_at DESC`, [salonId]);
        return rows;
    },
    async findById(id, salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM wa_templates WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return rows[0] || null;
    },
    async create(salonId, data) {
        const { rows } = await database_1.default.query(`
      INSERT INTO wa_templates (salon_id, name, category, language, header_type, header_text,
        header_media_id, body_text, footer_text, buttons, meta_template_id, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING *
    `, [salonId, data.name, data.category, data.language, data.header_type, data.header_text || null,
            data.header_media_id || null, data.body_text, data.footer_text || null,
            JSON.stringify(data.buttons), data.meta_template_id || null, data.status || 'PENDING']);
        return rows[0];
    },
    async updateStatus(id, status, metaTemplateId, rejectionReason) {
        const { rows } = await database_1.default.query(`
      UPDATE wa_templates SET status=$2, meta_template_id=COALESCE($3, meta_template_id),
        rejection_reason=$4, approved_at=CASE WHEN $2='APPROVED' THEN NOW() ELSE approved_at END, updated_at=NOW()
      WHERE id=$1 RETURNING *
    `, [id, status, metaTemplateId || null, rejectionReason || null]);
        return rows[0];
    },
    async delete(id, salonId) {
        const result = await database_1.default.query(`DELETE FROM wa_templates WHERE id=$1 AND salon_id=$2`, [id, salonId]);
        return (result.rowCount ?? 0) > 0;
    },
};
//# sourceMappingURL=templates.repository.js.map