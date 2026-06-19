import pool from "../../config/database";
import { Device, StaffBiometricMapping, CreateDeviceBody, UpdateDeviceBody, CreateMappingBody } from "./device.types";

export const deviceRepository = {

    // ── Devices ───────────────────────────────────────────────────────────────

    async findAll(salonId: string): Promise<Device[]> {
        const { rows } = await pool.query(
            `SELECT * FROM devices WHERE salon_id = $1 ORDER BY created_at ASC`,
            [salonId]
        );
        return rows;
    },

    async findById(id: string): Promise<Device | null> {
        const { rows } = await pool.query(
            `SELECT * FROM devices WHERE id = $1`,
            [id]
        );
        return rows[0] || null;
    },

    async findBySerialNo(serialNo: string): Promise<Device | null> {
        const { rows } = await pool.query(
            `SELECT * FROM devices WHERE serial_no = $1`,
            [serialNo]
        );
        return rows[0] || null;
    },

    async create(salonId: string, data: CreateDeviceBody): Promise<Device> {
        const { rows } = await pool.query(
            `INSERT INTO devices (salon_id, serial_no, name, location)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [salonId, data.serial_no.trim().toUpperCase(), data.name, data.location ?? null]
        );
        return rows[0];
    },

    async update(id: string, data: UpdateDeviceBody): Promise<Device> {
        const keys = Object.keys(data) as (keyof UpdateDeviceBody)[];
        const setParts = keys.map((k, i) => `${String(k)} = $${i + 2}`);
        setParts.push(`updated_at = NOW()`);
        const values: any[] = [id, ...keys.map(k => (data as any)[k])];
        const { rows } = await pool.query(
            `UPDATE devices SET ${setParts.join(", ")} WHERE id = $1 RETURNING *`,
            values
        );
        return rows[0];
    },

    async delete(id: string): Promise<void> {
        await pool.query(`DELETE FROM devices WHERE id = $1`, [id]);
    },

    async updateLastSeen(serialNo: string, ip: string): Promise<void> {
        await pool.query(
            `UPDATE devices SET last_seen = NOW(), last_ip = $2, updated_at = NOW() WHERE serial_no = $1`,
            [serialNo, ip]
        );
    },

    // ── Staff biometric mappings ───────────────────────────────────────────────

    async getMappings(deviceId: string): Promise<StaffBiometricMapping[]> {
        const { rows } = await pool.query(
            `SELECT m.*,
                    TRIM(CONCAT(s.first_name, ' ', COALESCE(s.last_name, ''))) AS staff_name,
                    COALESCE(s.designation, '') AS staff_role
             FROM staff_biometric_mappings m
             JOIN staff s ON s.id = m.staff_id
             WHERE m.device_id = $1
             ORDER BY m.pin::integer ASC NULLS LAST`,
            [deviceId]
        );
        return rows;
    },

    async findMappingByPin(deviceId: string, pin: string): Promise<StaffBiometricMapping | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_biometric_mappings WHERE device_id = $1 AND pin = $2`,
            [deviceId, pin]
        );
        return rows[0] || null;
    },

    async createMapping(salonId: string, deviceId: string, data: CreateMappingBody): Promise<StaffBiometricMapping> {
        const { rows } = await pool.query(
            `INSERT INTO staff_biometric_mappings (salon_id, device_id, staff_id, pin)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (device_id, staff_id) DO UPDATE SET pin = EXCLUDED.pin
             RETURNING *`,
            [salonId, deviceId, data.staff_id, data.pin]
        );
        return rows[0];
    },

    async deleteMapping(id: string): Promise<void> {
        await pool.query(`DELETE FROM staff_biometric_mappings WHERE id = $1`, [id]);
    },
};
