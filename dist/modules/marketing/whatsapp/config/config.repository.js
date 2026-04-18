"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configRepository = void 0;
const database_1 = __importDefault(require("../../../../config/database"));
exports.configRepository = {
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
      UPDATE whatsapp_configs SET
        is_verified    = true,
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
//# sourceMappingURL=config.repository.js.map