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
  services: Array<{
    /** Real catalog services.id, when the frontend picked one from the catalog search. */
    serviceId?:     string;
    serviceName:    string;
    totalSessions:  number;
    price:          number;
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
  services:       Array<{
    service_id:          string;
    catalog_service_id:  string | null;
    service_name:        string;
    total_sessions:      number;
    completed_sessions:  number;
    price:               string;
  }> | null;
}
