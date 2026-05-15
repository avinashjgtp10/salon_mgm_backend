export interface PublicBookingRequest {
    salon_id: string;
    service_id: string;
    staff_id?: string;
    scheduled_at: string;
    client_name: string;
    client_email: string;
    client_phone: string;
    notes?: string;
}
