export interface MembershipsListQuery {
  search?:      string;   // ← ADD
  sessionType?: string;
  colour?:      string;
  validFor?:    string;
  page?:        number;
  limit?:       number;
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
  created_at:               Date;
  updated_at:               Date;
  services:                 IncludedService[] | null;
}