export type DiscountType = "percentage" | "fixed";

export interface PackageOffer {
  id:             string;
  offerName:      string;
  couponCode:     string;
  discountAmount: number;
  discountType:   DiscountType;
  startDate:      string | null;
  endDate:        string | null;
  minimumOrder:   number;
  isActive:       boolean;
}

export interface CreatePackageOfferDTO {
  offerName:      string;
  couponCode:     string;
  discountAmount: number;
  discountType:   DiscountType;
  startDate?:     string;
  endDate?:       string;
  minimumOrder?:  number;
  isActive?:      boolean;
}

export interface CreatePackageDTO {
  name:            string;
  slug:            string;
  description?:    string;
  basePrice:       number;
  discountValue?:  number;
  discountType?:   DiscountType;
  durationMinutes: number;
  category:        string;
  priority?:       number;
  serviceIds:      string[];
  offers:          CreatePackageOfferDTO[];
}

export interface UpdatePackageDTO extends Partial<CreatePackageDTO> {}

export interface PackagesListQuery {
  search?:   string;
  category?: string;
  page?:     number;
  limit?:    number;
}

export interface Package {
  id:              string;
  name:            string;
  slug:            string;
  description?:    string;
  basePrice:       number;
  discountValue:   number;
  discountType:    DiscountType;
  durationMinutes: number;
  category:        string;
  priority:        number;
  serviceIds:      string[];
  offers:          PackageOffer[];
  createdAt:       string;
  updatedAt:       string;
}

// ── Raw DB row shapes ────────────────────────────────────────────────────────

export interface PackageOfferRow {
  id:              string;
  offerName:       string;
  couponCode:      string;
  discountAmount:  string;
  discountType:    string;
  startDate:       string | null;
  endDate:         string | null;
  minimumOrder:    string;
  isActive:        boolean;
}

export interface PackageRow {
  id:               string;
  name:             string;
  slug:             string;
  description:      string | null;
  base_price:       string;
  discount_value:   string;
  discount_type:    string;
  duration_minutes: number;
  category:         string;
  priority:         number;
  created_at:       Date;
  updated_at:       Date;
  service_ids:      string[] | null;
  offers:           PackageOfferRow[] | null;
}
