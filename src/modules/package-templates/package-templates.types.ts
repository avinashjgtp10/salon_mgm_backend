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
  /** Free-text blurb shown on the "+ Package" row's info button in Calendar
   *  and Quick Sale. NULL for templates created before the column existed. */
  description:    string | null;
  expiryMonths:   number | null;
  /** Exact day-count for the picked expiry date — the precise source of truth;
   *  expiryMonths is kept only as a rounded, human-friendly label. */
  expiryDays:     number | null;
  neverExpires:   boolean;
  /** Optional aggregate cap: once a sold instance of this template has this
   *  many TOTAL completed sessions across ALL its services combined, the
   *  client's package closes early — regardless of individual services'
   *  remaining sessions. NULL means no early cap. */
  expireAfterServices: number | null;
  basePrice:      number;
  gstPercentage:  number;
  discount:       number;
  paymentMethod:  string;
  createdAt:      string;
  services:       PackageTemplateService[];
}

export interface CreatePackageTemplateDTO {
  name:           string;
  description?:   string | null;
  expiryMonths?:  number | null;
  expiryDays?:    number | null;
  neverExpires?:  boolean;
  expireAfterServices?: number | null;
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
