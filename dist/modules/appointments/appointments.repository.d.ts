import { Appointment, CreateAppointmentBody, UpdateAppointmentBody } from "./appointments.types";
export declare const appointmentsRepository: {
    findById(id: string): Promise<Appointment | null>;
    listBySalonId(salonId: string, filters: {
        date?: string;
        staff_id?: string;
        status?: string;
    }): Promise<Appointment[]>;
    listByClientId(clientId: string): Promise<Appointment[]>;
    hasConflict(params: {
        staffId: string;
        scheduledAt: string;
        durationMinutes: number;
        excludeId?: string;
    }): Promise<boolean>;
    create(data: CreateAppointmentBody, createdBy: string): Promise<Appointment>;
    update(id: string, patch: UpdateAppointmentBody): Promise<Appointment>;
    updateStatus(id: string, status: string): Promise<Appointment>;
    linkSale(id: string, saleId: string): Promise<Appointment>;
    exportList(filters: {
        salon_id?: string;
        status?: string;
        start_date?: string;
        end_date?: string;
    }): Promise<Appointment[]>;
};
//# sourceMappingURL=appointments.repository.d.ts.map