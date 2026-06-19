export type Device = {
    id: string;
    salon_id: string;
    serial_no: string;
    name: string;
    location: string | null;
    is_active: boolean;
    last_seen: string | null;
    last_ip: string | null;
    created_at: string;
    updated_at: string;
};

export type StaffBiometricMapping = {
    id: string;
    salon_id: string;
    device_id: string;
    staff_id: string;
    pin: string;
    created_at: string;
    // joined
    staff_name?: string;
    staff_role?: string;
};

export type CreateDeviceBody = {
    serial_no: string;
    name: string;
    location?: string;
};

export type UpdateDeviceBody = {
    name?: string;
    location?: string;
    is_active?: boolean;
};

export type CreateMappingBody = {
    staff_id: string;
    pin: string;
};
