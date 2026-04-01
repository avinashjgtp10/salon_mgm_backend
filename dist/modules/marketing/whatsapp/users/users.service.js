"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const error_middleware_1 = require("../../../../middleware/error.middleware");
const users_repository_1 = require("./users.repository");
exports.usersService = {
    async getAll(salonId) {
        return users_repository_1.usersRepository.findBySalonId(salonId);
    },
    async create(salonId, body) {
        const password_hash = await bcrypt_1.default.hash(body.password, 10);
        return users_repository_1.usersRepository.create(salonId, {
            first_name: body.first_name,
            last_name: body.last_name,
            email: body.email,
            password_hash,
            role: body.role,
        });
    },
    async update(id, salonId, body) {
        const exists = await users_repository_1.usersRepository.findById(id, salonId);
        if (!exists)
            throw new error_middleware_1.AppError(404, 'User not found', 'NOT_FOUND');
        const updates = {};
        if (body.first_name)
            updates.first_name = body.first_name;
        if (body.last_name)
            updates.last_name = body.last_name;
        if (body.email)
            updates.email = body.email;
        if (body.role)
            updates.role = body.role;
        if (body.password)
            updates.password_hash = await bcrypt_1.default.hash(body.password, 10);
        return users_repository_1.usersRepository.update(id, salonId, updates);
    },
    async remove(id, salonId) {
        const deleted = await users_repository_1.usersRepository.delete(id, salonId);
        if (!deleted)
            throw new error_middleware_1.AppError(404, 'User not found', 'NOT_FOUND');
        return { message: 'User removed successfully' };
    },
};
//# sourceMappingURL=users.service.js.map