"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRepo = void 0;
const database_1 = __importDefault(require("../../config/database"));
exports.usersRepo = {
    async findById(id) {
        const { rows } = await database_1.default.query(`SELECT * FROM users WHERE id=$1 LIMIT 1`, [id]);
        return rows[0] || null;
    },
    async findAll() {
        const { rows } = await database_1.default.query(`SELECT * FROM users ORDER BY created_at DESC`);
        return rows;
    },
    async updateById(id, updates) {
        const keys = Object.keys(updates);
        if (keys.length === 0)
            return this.findById(id);
        // Build dynamic update query
        const setClause = keys.map((k, i) => `"${k}"=$${i + 2}`).join(", ");
        const values = keys.map((k) => updates[k]);
        const { rows } = await database_1.default.query(`UPDATE users
       SET ${setClause}, updated_at=NOW()
       WHERE id=$1
       RETURNING *`, [id, ...values]);
        return rows[0] || null;
    },
    async deleteById(id) {
        const result = await database_1.default.query(`DELETE FROM users WHERE id=$1`, [id]);
        return (result.rowCount ?? 0) > 0;
    }
};
//# sourceMappingURL=users.repository.js.map