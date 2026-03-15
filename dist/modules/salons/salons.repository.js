"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.salonsRepository = void 0;
const database_1 = __importDefault(require("../../config/database"));
exports.salonsRepository = {
    async findById(id) {
        const { rows } = await database_1.default.query(`SELECT * FROM salons WHERE id = $1`, [id]);
        return rows[0] || null;
    },
    async findBySlug(slug) {
        const { rows } = await database_1.default.query(`SELECT * FROM salons WHERE slug = $1`, [slug]);
        return rows[0] || null;
    },
    async findByOwnerId(ownerId) {
        const { rows } = await database_1.default.query(`SELECT * FROM salons WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 1`, [ownerId]);
        return rows[0] || null;
    },
    async listAll() {
        const { rows } = await database_1.default.query(`SELECT * FROM salons ORDER BY created_at DESC`);
        return rows;
    },
    async create(ownerId, data) {
        const { rows } = await database_1.default.query(`INSERT INTO salons (
        owner_id, business_name, business_type, slug, description,
        logo_url, banner_url, email, phone, website_url, gst_number, pan_number
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`, [
            ownerId,
            data.business_name.trim(),
            data.business_type ?? null,
            data.slug ?? null,
            data.description ?? null,
            data.logo_url ?? null,
            data.banner_url ?? null,
            data.email ?? null,
            data.phone ?? null,
            data.website_url ?? null,
            data.gst_number ?? null,
            data.pan_number ?? null,
        ]);
        return rows[0];
    },
    async update(id, patch) {
        const keys = Object.keys(patch);
        // Nothing to update → return current
        if (keys.length === 0) {
            const { rows } = await database_1.default.query(`SELECT * FROM salons WHERE id = $1`, [id]);
            return rows[0];
        }
        const setParts = [];
        const values = [];
        keys.forEach((k, idx) => {
            setParts.push(`${k} = $${idx + 1}`);
            values.push(patch[k]);
        });
        // Always update updated_at
        setParts.push(`updated_at = NOW()`);
        values.push(id);
        const { rows } = await database_1.default.query(`UPDATE salons
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`, values);
        return rows[0];
    },
};
//# sourceMappingURL=salons.repository.js.map