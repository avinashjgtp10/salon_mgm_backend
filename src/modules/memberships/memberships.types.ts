export interface MembershipsListQuery {
  search?:      string;   // ← ADD
  sessionType?: string;
  colour?:      string;
  validFor?:    string;
  page?:        number;
  limit?:       number;
}

/**
 * 'value'      — wallet: pay a fee, get a spendable balance drawn down at face value.
 * 'percentage' — discount balance: N% off every service, where the discount GIVEN
 *                depletes a separate pool.
 * 'loyalty'    — free/automatic: unlocks N% off once a visit threshold is met,
 *                then applies indefinitely with no cap.
 */
export type MembershipPricingType = 'value' | 'percentage' | 'loyalty';

/**
 * Which line items a membership's benefit (wallet, discount, or loyalty
 * unlock) is eligible to cover. Replaces an older `appliesToProducts`
 * boolean, which could only ever express "services always eligible, products
 * optionally too" — with no way to say "products only."
 */
export type MembershipAppliesTo = 'services' | 'products' | 'both';

export interface LoyaltyEligibility {
  membershipId:    string;
  name:            string;
  discountPercent: number;
  thresholdValue:  number;
  /** Visits accumulated so far. */
  current:         number;
  eligible:        boolean;
  appliesTo:       MembershipAppliesTo;
}

// all other interfaces stay the same
export interface IncludedService {
  serviceId:        string;
  serviceName:      string;
  durationMinutes?: number;
}

export interface CreateMembershipDTO {
  name:                   string;
  description?:           string;
  includedServices:       IncludedService[];
  sessionType:            string;
  numberOfSessions?:      number;
  validFor:               string;
  price:                  number;
  taxRate?:               number;
  colour:                 string;
  enableOnlineSales:      boolean;
  enableOnlineRedemption: boolean;
  termsAndConditions?:    string;
  /** Defaults to 'services' server-side when omitted, matching the old boolean's default. */
  appliesTo?:             MembershipAppliesTo;
  pricingType?:           MembershipPricingType;
  discountPercent?:       number;
  /** 'percentage' only — the depleting pool of discount this plan may hand out. */
  discountBalance?:       number;
  /** 'loyalty' only — how many visits have to accumulate before the discount unlocks. */
  loyaltyThresholdValue?: number;
}

export interface UpdateMembershipDTO extends Partial<CreateMembershipDTO> {}

export interface Membership extends CreateMembershipDTO {
  id:        string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipRow {
  id:                       string;
  name:                     string;
  description:              string | null;
  session_type:             string;
  number_of_sessions:       number | null;
  valid_for:                string;
  price:                    string;
  tax_rate:                 string | null;
  colour:                   string;
  enable_online_sales:      boolean;
  enable_online_redemption: boolean;
  terms_and_conditions:     string | null;
  applies_to:               MembershipAppliesTo;
  pricing_type:             MembershipPricingType;
  discount_percent:         string | null;
  discount_balance:         string | null;
  loyalty_threshold_value:  number | null;
  created_at:               Date;
  updated_at:               Date;
  services:                 IncludedService[] | null;
}