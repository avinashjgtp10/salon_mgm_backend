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

/** One rung of a loyalty plan's tier ladder — e.g. 10 visits unlocks 20% off. */
export interface LoyaltyTier {
  thresholdValue:  number;
  discountPercent: number;
}

export interface LoyaltyEligibility {
  membershipId:    string;
  name:            string;
  /** Plain-text description pulled out of the plan's JSON-encoded description field. */
  description?:    string;
  /** Visits accumulated so far. */
  current:         number;
  /** True once the client has crossed at least the first tier. */
  eligible:        boolean;
  /** The highest tier crossed so far — its discountPercent is what actually
   *  applies (tiers never stack). Null when not yet eligible. */
  currentTier:     LoyaltyTier | null;
  /** The next tier still to unlock, for progress display. Null once the
   *  client has crossed every tier the plan defines. */
  nextTier:        LoyaltyTier | null;
  /** Pass-through of currentTier.discountPercent (0 when ineligible) — kept
   *  flat so existing consumers (payments.service.ts, pricing.service.ts)
   *  that only ever cared about "the rate to apply" need no changes. */
  discountPercent: number;
  appliesTo:       MembershipAppliesTo;
  /** Optional narrowing of appliesTo to specific categories — empty/undefined
   *  means unrestricted (every category within appliesTo's scope). */
  categoryIds:     string[];
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
  /** Optional narrowing of appliesTo to specific service_categories rows —
   *  empty/omitted means unrestricted (every category within appliesTo's scope). */
  categoryIds?:           string[];
  pricingType?:           MembershipPricingType;
  discountPercent?:       number;
  /** 'percentage' only — the depleting pool of discount this plan may hand out. */
  discountBalance?:       number;
  /** 'loyalty' only — the tier ladder (visits → discount%), ascending by
   *  thresholdValue. Replaces the old single loyaltyThresholdValue/discountPercent
   *  pair, which loyalty plans no longer write. */
  loyaltyTiers?:          LoyaltyTier[];
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
  category_ids:             string[] | null;
  pricing_type:             MembershipPricingType;
  discount_percent:         string | null;
  discount_balance:         string | null;
  loyalty_threshold_value:  number | null;
  loyalty_tiers:            LoyaltyTier[] | null;
  created_at:               Date;
  updated_at:               Date;
  services:                 IncludedService[] | null;
}