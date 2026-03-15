"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipsController = void 0;
const memberships_service_1 = require("./memberships.service");
const response_util_1 = require("../utils/response.util");
exports.membershipsController = {
    async list(req, res, next) {
        try {
            const data = await memberships_service_1.membershipsService.list(req.query);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Memberships fetched successfully");
        }
        catch (e) {
            return next(e);
        }
    },
    async create(req, res, next) {
        try {
            const data = await memberships_service_1.membershipsService.create(req.body);
            return (0, response_util_1.sendSuccess)(res, 201, data, "Membership created successfully");
        }
        catch (e) {
            return next(e);
        }
    },
    async getById(req, res, next) {
        try {
            const id = req.params.id;
            const data = await memberships_service_1.membershipsService.getById(id);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Membership fetched successfully");
        }
        catch (e) {
            return next(e);
        }
    },
    async update(req, res, next) {
        try {
            const id = req.params.id;
            const data = await memberships_service_1.membershipsService.update(id, req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Membership updated successfully");
        }
        catch (e) {
            return next(e);
        }
    },
    async delete(req, res, next) {
        try {
            const id = req.params.id;
            await memberships_service_1.membershipsService.delete(id);
            return (0, response_util_1.sendSuccess)(res, 200, {}, "Membership deleted successfully");
        }
        catch (e) {
            return next(e);
        }
    },
};
//# sourceMappingURL=memberships.controller.js.map