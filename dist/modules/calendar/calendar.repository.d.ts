import { Appointment, CreateAppointmentBody, UpdateAppointmentBody, ListAppointmentsFilters } from "./calendar.types";
export declare const calendarRepository: {
    findById(id: string): Promise<Appointment | null>;
    list(filters: ListAppointmentsFilters): Promise<{
        data: Appointment[];
        total: number;
    }>;
    hasConflict(params: {
        staff_id: string;
        scheduled_at: string;
        duration_minutes: number;
        excludeId?: string;
    }): Promise<boolean>;
    create(data: CreateAppointmentBody, createdBy: string): Promise<Appointment>;
    update(id: string, patch: UpdateAppointmentBody): Promise<Appointment>;
    updateStatus(id: string, status: string, extra?: Record<string, unknown>): Promise<Appointment>;
    linkSale(appointmentId: string, saleId: string): Promise<void>;
};
//# sourceMappingURL=calendar.repository.d.ts.map