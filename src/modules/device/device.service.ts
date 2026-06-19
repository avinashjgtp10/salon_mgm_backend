import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { deviceRepository } from "./device.repository";
import { attendanceService } from "../attendance/attendance.service";
import { Device, StaffBiometricMapping, CreateDeviceBody, UpdateDeviceBody, CreateMappingBody } from "./device.types";

// In-memory store for machines that have connected but aren't registered yet.
// Cleared on server restart (machines reconnect quickly, so that's fine).
type PendingEntry = { sn: string; ip: string; firstSeen: Date; lastSeen: Date };
const pendingDevices = new Map<string, PendingEntry>();

export const deviceService = {

    // ── Device CRUD ──────────────────────────────────────────────────────────

    async listDevices(salonId: string): Promise<Device[]> {
        return deviceRepository.findAll(salonId);
    },

    async addDevice(salonId: string, data: CreateDeviceBody): Promise<Device> {
        if (!data.serial_no?.trim()) throw new AppError(400, "serial_no is required", "VALIDATION_ERROR");
        if (!data.name?.trim())      throw new AppError(400, "name is required",      "VALIDATION_ERROR");
        const existing = await deviceRepository.findBySerialNo(data.serial_no.trim().toUpperCase());
        if (existing) throw new AppError(409, "A device with this serial number is already registered", "DUPLICATE");
        return deviceRepository.create(salonId, data);
    },

    async updateDevice(id: string, salonId: string, data: UpdateDeviceBody): Promise<Device> {
        const device = await deviceRepository.findById(id);
        if (!device || device.salon_id !== salonId)
            throw new AppError(404, "Device not found", "NOT_FOUND");
        return deviceRepository.update(id, data);
    },

    async removeDevice(id: string, salonId: string): Promise<void> {
        const device = await deviceRepository.findById(id);
        if (!device || device.salon_id !== salonId)
            throw new AppError(404, "Device not found", "NOT_FOUND");
        await deviceRepository.delete(id);
    },

    // ── Staff PIN mappings ────────────────────────────────────────────────────

    async getMappings(deviceId: string, salonId: string): Promise<StaffBiometricMapping[]> {
        const device = await deviceRepository.findById(deviceId);
        if (!device || device.salon_id !== salonId)
            throw new AppError(404, "Device not found", "NOT_FOUND");
        return deviceRepository.getMappings(deviceId);
    },

    async addMapping(deviceId: string, salonId: string, data: CreateMappingBody): Promise<StaffBiometricMapping> {
        const device = await deviceRepository.findById(deviceId);
        if (!device || device.salon_id !== salonId)
            throw new AppError(404, "Device not found", "NOT_FOUND");
        if (!data.staff_id || !data.pin?.trim())
            throw new AppError(400, "staff_id and pin are required", "VALIDATION_ERROR");
        return deviceRepository.createMapping(salonId, deviceId, data);
    },

    async removeMapping(mappingId: string): Promise<void> {
        await deviceRepository.deleteMapping(mappingId);
    },

    // ── ADMS: process attendance push from machine ────────────────────────────

    async processAttLog(serialNo: string, rawBody: string, ip: string): Promise<number> {
        const device = await deviceRepository.findBySerialNo(serialNo);
        if (!device || !device.is_active) {
            logger.warn("ADMS: unknown or inactive device", { serialNo });
            return 0;
        }

        // Update heartbeat
        await deviceRepository.updateLastSeen(serialNo, ip);

        const lines = rawBody.trim().split(/\r?\n/).filter(l => l.trim());
        let processed = 0;

        for (const line of lines) {
            try {
                const fields = parseLine(line);
                if (!fields) continue;

                const { pin, timeStr, status } = fields;

                const mapping = await deviceRepository.findMappingByPin(device.id, pin);
                if (!mapping) {
                    logger.warn("ADMS: no staff mapping for PIN", { deviceId: device.id, pin });
                    continue;
                }

                // Machine sends local IST time — append IST offset
                const timestamp = new Date(timeStr.replace(" ", "T") + "+05:30").toISOString();

                // status 0/4 = check-in, 1/2/5 = check-out
                const checkType: "in" | "out" = (status === 0 || status === 4) ? "in" : "out";

                await attendanceService.push(device.salon_id, {
                    staff_id: mapping.staff_id,
                    check_type: checkType,
                    timestamp,
                    source: "biometric",
                });

                processed++;
                logger.info("ADMS: processed attendance", { serialNo, pin, checkType, timestamp });
            } catch (err) {
                logger.warn("ADMS: failed to process line", { line, err });
            }
        }

        return processed;
    },

    async handleHeartbeat(serialNo: string, ip: string): Promise<void> {
        const device = await deviceRepository.findBySerialNo(serialNo);
        if (device) {
            await deviceRepository.updateLastSeen(serialNo, ip);
            pendingDevices.delete(serialNo); // already registered — clean up if it was pending
        } else {
            // Unknown device — park it in the pending map for the UI to discover
            const existing = pendingDevices.get(serialNo);
            pendingDevices.set(serialNo, {
                sn: serialNo,
                ip,
                firstSeen: existing?.firstSeen ?? new Date(),
                lastSeen: new Date(),
            });
            logger.info("ADMS: discovered unregistered device", { serialNo, ip });
        }
    },

    // ── Device discovery ──────────────────────────────────────────────────────

    getPending(): PendingEntry[] {
        return Array.from(pendingDevices.values())
            .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
    },

    async connectPending(salonId: string, sn: string, name: string, location?: string): Promise<Device> {
        const existing = await deviceRepository.findBySerialNo(sn);
        if (existing) throw new AppError(409, "A device with this serial number is already registered", "DUPLICATE");
        const device = await deviceRepository.create(salonId, {
            serial_no: sn,
            name: name.trim(),
            location: location?.trim() || undefined,
        });
        pendingDevices.delete(sn);
        return device;
    },
};

// ── ATTLOG line parser ─────────────────────────────────────────────────────────
// Handles both tab-separated key=value format and positional format

function parseLine(line: string): { pin: string; timeStr: string; status: number } | null {
    const parts = line.split("\t");
    if (parts.length < 3) return null;

    let pin: string, timeStr: string, status: number;

    if (parts[0].includes("=")) {
        // Key=Value format: PIN=1\tTime=2026-06-19 09:15:00\tStatus=0\t...
        const map: Record<string, string> = {};
        for (const p of parts) {
            const eq = p.indexOf("=");
            if (eq > -1) map[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).trim();
        }
        pin     = map["PIN"]    || "";
        timeStr = map["TIME"]   || "";
        status  = parseInt(map["STATUS"] || "0", 10);
    } else {
        // Positional format: 1\t2026-06-19 09:15:00\t0\t1
        pin     = parts[0].trim();
        timeStr = parts[1].trim();
        status  = parseInt(parts[2].trim() || "0", 10);
    }

    if (!pin || !timeStr) return null;
    return { pin, timeStr, status };
}
