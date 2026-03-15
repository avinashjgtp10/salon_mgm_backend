"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoriesRepository = void 0;
const database_1 = __importDefault(require("../../config/database"));
exports.categoriesRepository = {
    async findByIdInSalon(id, salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM service_categories WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return rows[0] || null;
    },
    async listBySalonId(salonId) {
        const { rows } = await database_1.default.query(`SELECT *
       FROM service_categories
       WHERE salon_id = $1
       ORDER BY display_order ASC, created_at DESC`, [salonId]);
        return rows;
    },
    async create(salonId, data) {
        const { rows } = await database_1.default.query(`INSERT INTO service_categories (salon_id, name, description, display_order, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`, [
            salonId,
            data.name.trim(),
            data.description ?? null,
            data.display_order ?? 0,
            data.is_active ?? true,
        ]);
        return rows[0];
    },
    async update(id, salonId, patch) {
        const allowed = ["name", "description", "display_order", "is_active"];
        const entries = allowed
            .filter((k) => patch[k] !== undefined)
            .map((k) => [k, patch[k]]);
        if (entries.length === 0) {
            return this.findByIdInSalon(id, salonId);
        }
        const setParts = [];
        const values = [];
        entries.forEach(([key, value], idx) => {
            if (key === "name" && typeof value === "string")
                value = value.trim();
            setParts.push(`${String(key)} = $${idx + 1}`);
            values.push(value);
        });
        values.push(id);
        values.push(salonId);
        const { rows } = await database_1.default.query(`UPDATE service_categories
       SET ${setParts.join(", ")}
       WHERE id = $${values.length - 1} AND salon_id = $${values.length}
       RETURNING *`, values);
        return rows[0] || null;
    },
    async remove(id, salonId) {
        const { rows } = await database_1.default.query(`DELETE FROM service_categories
       WHERE id = $1 AND salon_id = $2
       RETURNING id`, [id, salonId]);
        return rows[0] || null;
    },
};
//# sourceMappingURL=categories.repository.js.map