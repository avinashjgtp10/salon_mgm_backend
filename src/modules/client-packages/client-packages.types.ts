export interface ClientPackageService {
  serviceId:          string;
  // Real catalog services.id — lets redemption/coverage matching be exact
  // even when two catalog services share a display name (e.g. two "Hair
  // Cut" entries at different prices). Null on packages sold before this
  // existed; callers fall back to name-matching in that case.
  catalogServiceId:   string | null;
  serviceName:        string;
  totalSessions:      number;
  completedSessions:  number;
  remainingSessions:  number;
  price:              number;
  // One entry per session that has ever been scheduled (booked as a future
  // appointment at sale time or afterwards) for this service line. A
  // service with totalSessions > 1 can have some sessions scheduled and
  // others not yet — "Not Scheduled"/"Expired" slots are never stored here,
  // they're derived by the UI from (totalSessions - scheduleSlots.length)
  // and the parent package's expiryDate.
  scheduleSlots:      ClientPackageServiceScheduleSlot[];
}

export interface ClientPackageServiceScheduleSlot {
  id:            string;
  appointmentId: string;
  staffId:       string | null;
  staffName?:    string | null;
  status:        "Scheduled" | "Completed" | "Cancelled" | "No Show";
  scheduledAt:   string | null;
}

export interface ClientPackageSessionHistory {
  id:          string;
  serviceId:   string;
  sessionNo:   number;
  date:        string;
  staff:       string;
  status:      string;
}

export interface CreateClientPackageDTO {
  clientId:       string;
  packageName:    string;
  category?:      string;
  branch?:        string;
  expiryDate:     string;
  basePrice:      number;
  gstPercentage:  number;
  discount:       number;
  paymentMethod:  string;
  /** Method -> amount breakdown, present only when paymentMethod === "split". */
  splitDetails?:  Record<string, number>;
  /** Set only by autoCreateFromPayment — the appointment this package was sold within. */
  appointmentId?: string | null;
  /** Staff member who sold this package — feeds client_packages.staff_id and the sales/sale_items rows recordTransaction() creates. */
  staffId?:       string;
  /** Copied from the template's own expireAfterServices at sale time (see
   *  package-templates.types.ts) — set only when sold from a template that
   *  defines this cap. NULL/undefined for custom/combo packages and
   *  templates with no cap. */
  expireAfterServices?: number | null;
  /** Copied from the template/bundle's own description at sale time, same
   *  convention as client_memberships.description. NULL/undefined when the
   *  source has none, or for a custom package built with no template. */
  description?: string | null;
  services: Array<{
    /** Real catalog services.id, when the frontend picked one from the catalog search. */
    serviceId?:     string;
    serviceName:    string;
    totalSessions:  number;
    price:          number;
    /**
     * Optional: book one future appointment for this service right now,
     * consuming one of its totalSessions once that appointment completes
     * (not when this package is created — see completeSession). Only ever
     * schedules a single session per service at package-creation time; a
     * service with totalSessions > 1 keeps its remaining sessions
     * unscheduled for later, individual booking.
     */
    schedule?: {
      scheduledAt:      string;
      staffId?:         string;
      durationMinutes?: number;
    };
  }>;
}

export interface UpdateClientPackageDTO {
  packageName?:    string;
  expiryDate?:     string;
  paymentMethod?:  string;
  basePrice?:      number;
  gstPercentage?:  number;
  discount?:       number;
  services?: Array<{
    serviceId:      string;
    serviceName?:   string;
    totalSessions?: number;
    price?:         number;
  }>;
}

export interface CompleteSessionDTO {
  serviceId:  string;
  staffName:  string;
  appointmentId?: string;
}

export interface ClientPackage {
  id:             string;
  salonId:        string;
  clientId:       string;
  clientName:     string;
  mobile?:        string;
  email?:         string;
  packageName:    string;
  category:       string;
  branch:         string;
  createdDate:    string;
  expiryDate:     string;
  /** See CreateClientPackageDTO.expireAfterServices. NULL means no early cap. */
  expireAfterServices: number | null;
  /** See CreateClientPackageDTO.description. NULL for packages sold before this column existed, or with no source description. */
  description:    string | null;
  status:         string;
  basePrice:      number;
  gstPercentage:  number;
  gstAmount:      number;
  discount:       number;
  totalAmount:    number;
  paymentMethod:  string;
  splitDetails:   Record<string, number> | null;
  paidAmount:     number;
  pendingAmount:  number;
  paymentStatus:  string;
  services:       ClientPackageService[];
  // Set only when this row was auto-created as a byproduct of paying an
  // appointment that had this package as a line item — that value is
  // already counted in the appointment's own total, so client-revenue
  // aggregation (useClientDetails.ts) must skip any row with this set to
  // avoid double-counting. NULL/undefined means a genuine standalone sale.
  appointmentId?: string | null;
  // Staff who sold the package, and the sales row recordTransaction()
  // created for it (for invoice_no lookup). NULL on rows sold before these
  // columns existed.
  staffId?:       string | null;
  saleId?:        string | null;
  // Response-only, never persisted: set by create() when one or more
  // services carried a `schedule` that failed to auto-book (e.g. a blocked
  // time slot). The package itself is still created/paid successfully —
  // this just tells the caller which services still need manual scheduling.
  schedulingErrors?: Array<{ serviceName: string; error: string }>;
}

export interface ClientPackagesListQuery {
  clientId?: string;
  search?:   string;
  status?:   string;
  page?:     number;
  limit?:    number;
}

// ── Raw DB row shapes ─────────────────────────────────────────────────────────

export interface ClientPackageRow {
  id:             string;
  salon_id:       string;
  client_id:      string;
  client_name:    string;
  mobile:         string | null;
  email:          string | null;
  package_name:   string;
  category:       string;
  branch:         string;
  created_date:   Date;
  expiry_date:    string;
  expire_after_services: number | null;
  description:    string | null;
  status:         string;
  base_price:     string;
  gst_percentage: string;
  gst_amount:     string;
  discount:       string;
  total_amount:   string;
  payment_method: string;
  split_details:  Record<string, number> | null;
  paid_amount:    string;
  pending_amount: string;
  payment_status: string;
  appointment_id?: string | null;
  staff_id?:      string | null;
  sale_id?:       string | null;
  services:       Array<{
    service_id:          string;
    catalog_service_id:  string | null;
    service_name:        string;
    total_sessions:      number;
    completed_sessions:  number;
    price:               string;
  }> | null;
  // Keyed by client_package_service_id -> its schedule rows (raw, snake_case).
  schedule_map: Record<string, Array<{
    id:            string;
    appointment_id: string;
    staff_id:      string | null;
    staff_name:    string | null;
    status:        string;
    scheduled_at:  string | null;
  }>> | null;
}
