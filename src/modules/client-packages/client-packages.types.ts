export interface ClientPackageService {
  serviceId:          string;
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
  services: Array<{
    serviceName:    string;
    totalSessions:  number;
    price:          number;
  }>;
}

export interface CompleteSessionDTO {
  serviceId:  string;
  staffName:  string;
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
  paid_amount:    string;
  pending_amount: string;
  payment_status: string;
  services:       Array<{
    service_id:          string;
    service_name:        string;
    total_sessions:      number;
    completed_sessions:  number;
    price:               string;
  }> | null;
}
