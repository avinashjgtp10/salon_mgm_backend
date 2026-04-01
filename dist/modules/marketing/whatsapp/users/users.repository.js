"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.waUsersRepo = void 0;
const database_1 = __importDefault(require("../../../../config/database"));
const uuid_1 = require("uuid");
exports.waUsersRepo = {
    async findBySalonId(salonId) {
        const { rows } = await database_1.default.query(`
      SELECT id, first_name, last_name, email, role, is_active, created_at
      FROM users WHERE salon_id=$1 ORDER BY created_at DESC
    `, [salonId]);
        return rows;
    },
    async create(salonId, data) {
        const { rows } = await database_1.default.query(`
      INSERT INTO users (id, salon_id, first_name, email, password_hash, role, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,true)
      RETURNING id, first_name, email, role, is_active, created_at
    `, [(0, uuid_1.v4)(), salonId, data.name, data.email, data.passwordHash, data.role]);
        return rows[0];
    },
    async delete(id, salonId) {
        const result = await database_1.default.query(`DELETE FROM users WHERE id=$1 AND salon_id=$2`, [id, salonId]);
        return (result.rowCount ?? 0) > 0;
    },
};
//# sourceMappingURL=users.repository.js.map