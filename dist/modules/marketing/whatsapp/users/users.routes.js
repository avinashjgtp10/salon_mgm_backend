"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const bcrypt_1 = __importDefault(require("bcrypt"));
const users_repository_1 = require("./users.repository");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.get('/', async (req, res, next) => {
    try {
        const salonId = req.user?.salonId;
        if (!salonId)
            return res.status(400).json({ success: false, message: 'salonId missing' });
        const data = await users_repository_1.waUsersRepo.findBySalonId(salonId);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
router.post('/', async (req, res, next) => {
    try {
        const salonId = req.user?.salonId;
        if (!salonId)
            return res.status(400).json({ success: false, message: 'salonId missing' });
        const { name, email, password, role } = req.body;
        const passwordHash = await bcrypt_1.default.hash(password, 10);
        const data = await users_repository_1.waUsersRepo.create(salonId, { name, email, passwordHash, role });
        res.status(201).json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', async (req, res, next) => {
    try {
        const salonId = req.user?.salonId;
        if (!salonId)
            return res.status(400).json({ success: false, message: 'salonId missing' });
        const deleted = await users_repository_1.waUsersRepo.delete(String(req.params.id), salonId);
        if (!deleted)
            return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, message: 'User removed' });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=users.routes.js.map