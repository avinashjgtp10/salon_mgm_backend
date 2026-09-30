// One selected service plus, optionally, the specific stylist the customer
// picked for it — absent/undefined means "any available stylist" for that
// service alone, same meaning as an absent top-level staff_id has always had
// for the whole booking.
export interface BookingServiceSelection {
    service_id: string;
    staff_id?: string;
}

export interface PublicBookingRequest {
    salon_id: string;
    service_ids: string[];
    staff_id?: string;
    // Per-service staff assignment — when present, takes precedence over the
    // single top-level staff_id for deciding who performs each service, but
    // service_ids above still lists every service, so older behaviour (one
    // staff_id, or none, for the whole cart) needs no separate code path
    // beyond building a uniform service_staff internally.
    service_staff?: BookingServiceSelection[];
    scheduled_at: string;
    client_name: string;
    client_email: string;
    client_phone: string;
    notes?: string;
}
