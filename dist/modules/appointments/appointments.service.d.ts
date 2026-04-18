import { Appointment, CreateAppointmentBody, UpdateAppointmentBody, CancelAppointmentBody } from "./appointments.types";
export declare const appointmentsService: {
    create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateAppointmentBody;
    }): Promise<Appointment>;
    getById(id: string): Promise<Appointment>;
    list(params: {
        salonId?: string;
        clientId?: string;
        date?: string;
        staffId?: string;
        status?: string;
    }): Promise<Appointment[]>;
    update(params: {
        appointmentId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateAppointmentBody;
    }): Promise<Appointment>;
    confirm(appointmentId: string): Promise<Appointment>;
    start(appointmentId: string): Promise<Appointment>;
    cancel(params: {
        appointmentId: string;
        requesterUserId: string;
        body: CancelAppointmentBody;
    }): Promise<Appointment>;
    noShow(appointmentId: string): Promise<Appointment>;
    checkout(params: {
        appointmentId: string;
        requesterUserId: string;
        requesterRole?: string;
        saleItems: any[];
        discount_amount?: number;
        tip_amount?: number;
        tax_amount?: number;
        payment_method?: string;
        notes?: string;
    }): Promise<{
        appointment: Appointment;
        saleId: string;
    }>;
    exportAppointments(filters: {
        salon_id?: string;
        status?: string;
        start_date?: string;
        end_date?: string;
        format: "csv" | "excel";
    }): Promise<{
        buffer: Buffer;
        contentType: string;
        filename: string;
    }>;
};
//# sourceMappingURL=appointments.service.d.ts.map