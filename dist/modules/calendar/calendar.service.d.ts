import { Appointment, CreateAppointmentBody, UpdateAppointmentBody, CancelAppointmentBody, CheckoutAppointmentBody, ListAppointmentsFilters } from "./calendar.types";
export declare const calendarService: {
    create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateAppointmentBody;
    }): Promise<Appointment>;
    getById(id: string): Promise<Appointment>;
    list(filters: ListAppointmentsFilters): Promise<{
        data: Appointment[];
        total: number;
        page: number;
        limit: number;
    }>;
    update(params: {
        appointmentId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateAppointmentBody;
    }): Promise<Appointment>;
    confirm(appointmentId: string): Promise<Appointment>;
    start(appointmentId: string): Promise<Appointment>;
    cancel(appointmentId: string, body: CancelAppointmentBody): Promise<Appointment>;
    noShow(appointmentId: string): Promise<Appointment>;
    checkout(params: {
        appointmentId: string;
        requesterUserId: string;
        body: CheckoutAppointmentBody;
    }): Promise<{
        appointment: Appointment;
        sale: Record<string, unknown>;
    }>;
};
//# sourceMappingURL=calendar.service.d.ts.map