import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { deviceService } from "./device.service";
import { CreateDeviceBody, UpdateDeviceBody, CreateMappingBody } from "./device.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const deviceController = {

    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const devices = await deviceService.listDevices(salonId);
            return sendSuccess(res, 200, devices, "Devices fetched");
        } catch (err) { return next(err); }
    },

    async add(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const device = await deviceService.addDevice(salonId, req.body as CreateDeviceBody);
            return sendSuccess(res, 201, device, "Device registered");
        } catch (err) { return next(err); }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const device = await deviceService.updateDevice(String(req.params.id), salonId, req.body as UpdateDeviceBody);
            return sendSuccess(res, 200, device, "Device updated");
        } catch (err) { return next(err); }
    },

    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            await deviceService.removeDevice(String(req.params.id), salonId);
            return sendSuccess(res, 200, null, "Device removed");
        } catch (err) { return next(err); }
    },

    async getMappings(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const mappings = await deviceService.getMappings(String(req.params.id), salonId);
            return sendSuccess(res, 200, mappings, "Mappings fetched");
        } catch (err) { return next(err); }
    },

    async addMapping(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const mapping = await deviceService.addMapping(String(req.params.id), salonId, req.body as CreateMappingBody);
            return sendSuccess(res, 201, mapping, "Mapping added");
        } catch (err) { return next(err); }
    },

    async removeMapping(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await deviceService.removeMapping(String(req.params.mappingId));
            return sendSuccess(res, 200, null, "Mapping removed");
        } catch (err) { return next(err); }
    },

    // ── Discovery ─────────────────────────────────────────────────────────────

    async getPending(_req: AuthRequest, res: Response, next: NextFunction) {
        try {
            return sendSuccess(res, 200, deviceService.getPending(), "Pending devices");
        } catch (err) { return next(err); }
    },

    async connectPending(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const { name, location } = req.body as { name: string; location?: string };
            if (!name?.trim()) throw new AppError(400, "name is required", "VALIDATION_ERROR");
            const device = await deviceService.connectPending(salonId, String(req.params.sn), name, location);
            return sendSuccess(res, 201, device, "Device connected");
        } catch (err) { return next(err); }
    },
};
