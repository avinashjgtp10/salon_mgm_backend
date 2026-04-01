"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersController = void 0;
const users_service_1 = require("./users.service");
exports.usersController = {
    async getAll(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            // Frontend: api.get('/users').then(r => r.data)
            const data = await users_service_1.usersService.getAll(salonId);
            return res.status(200).json(data);
        }
        catch (e) {
            return next(e);
        }
    },
    async create(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            // Frontend: api.post('/users', payload).then(r => r.data)
            const data = await users_service_1.usersService.create(salonId, req.body);
            return res.status(201).json(data);
        }
        catch (e) {
            return next(e);
        }
    },
    async update(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            // Frontend: api.patch('/users/:id', payload).then(r => r.data)
            const data = await users_service_1.usersService.update(String(req.params.id), salonId, req.body);
            return res.status(200).json(data);
        }
        catch (e) {
            return next(e);
        }
    },
    async remove(req, res, next) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId)
                return res.status(400).json({ error: 'salonId missing from token' });
            // Frontend: api.delete('/users/:id').then(r => r.data)
            const data = await users_service_1.usersService.remove(String(req.params.id), salonId);
            return res.status(200).json(data);
        }
        catch (e) {
            return next(e);
        }
    },
};
//# sourceMappingURL=users.controller.js.map