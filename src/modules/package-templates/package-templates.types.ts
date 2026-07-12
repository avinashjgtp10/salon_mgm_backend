export interface PackageTemplateService {
  id:            string;
  templateId:    string;
  serviceName:   string;
  totalSessions: number;
  price:         number;
}

export interface PackageTemplate {
  id:             string;
  salonId:        string;
  name:           string;
  expiryMonths:   number | null;
  /** Exact day-count for the picked expiry date — the precise source of truth;
   *  expiryMonths is kept only as a rounded, human-friendly label. */
  expiryDays:     number | null;
  neverExpires:   boolean;
  basePrice:      number;
  gstPercentage:  number;
  discount:       number;
  paymentMethod:  string;
  createdAt:      string;
  services:       PackageTemplateService[];
}

export interface CreatePackageTemplateDTO {
  name:           string;
  expiryMonths?:  number | null;
  expiryDays?:    number | null;
  neverExpires?:  boolean;
  basePrice:      number;
  gstPercentage?: number;
  discount?:      number;
  paymentMethod?: string;
  services: Array<{
    serviceName:   string;
    totalSessions: number;
    price:         number;
  }>;
}

export interface UpdatePackageTemplateDTO extends Partial<CreatePackageTemplateDTO> {}
