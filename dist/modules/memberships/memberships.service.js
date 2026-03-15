"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipsService = void 0;
const memberships_repository_1 = require("./memberships.repository"); // ✅ fixed name
const normalize = (val) => val ? val.trim().toLowerCase() : val;
exports.membershipsService = {
    async list(query) {
        return memberships_repository_1.membershipsRepository.list(query); // ✅ fixed - query is now used
    },
    async create(data) {
        data.sessionType = normalize(data.sessionType);
        data.validFor = normalize(data.validFor);
        data.colour = normalize(data.colour);
        if (data.sessionType !== "limited")
            data.numberOfSessions = undefined;
        return memberships_repository_1.membershipsRepository.create(data);
    },
    async getById(id) {
        const m = await memberships_repository_1.membershipsRepository.findById(id);
        if (!m)
            throw new Error(`Membership '${id}' not found`);
        return m;
    },
    async update(id, data) {
        if (data.sessionType)
            data.sessionType = normalize(data.sessionType);
        if (data.validFor)
            data.validFor = normalize(data.validFor);
        if (data.colour)
            data.colour = normalize(data.colour);
        if (data.sessionType && data.sessionType !== "limited") {
            data.numberOfSessions = undefined;
        }
        const updated = await memberships_repository_1.membershipsRepository.update(id, data);
        if (!updated)
            throw new Error(`Membership '${id}' not found`);
        return updated;
    },
    async delete(id) {
        const deleted = await memberships_repository_1.membershipsRepository.delete(id);
        if (!deleted)
            throw new Error(`Membership '${id}' not found`);
        return { message: "Membership deleted successfully" };
    },
};
//# sourceMappingURL=memberships.service.js.map