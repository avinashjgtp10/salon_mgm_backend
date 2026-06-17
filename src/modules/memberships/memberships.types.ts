export interface MembershipsListQuery {
  search?: string;
  sessionType?: string;
  numberOfSessions?: number | string;
  sessions?: string;
  colour?: string;
  validFor?: string;
  onlyAllServices?: boolean;
  page?: number;
  limit?: number;
}

export interface MembershipsFilterQuery {
  sessionType?: string;
  numberOfSessions?: number | string;
  sessions?: string;
  validFor?: string;
  onlyAllServices?: boolean;
  page?: number;
  limit?: number;
}

export interface IncludedService {
  serviceId: string;
  serviceName: string;
  durationMinutes?: number;
}

export interface CreateMembershipDTO {
  name: string;
  description?: string;
  includedServices: IncludedService[];
  sessionType: string;
  numberOfSessions?: number;
  validFor: string;
  price: number;
  taxRate?: number;
  colour: string;
  enableOnlineSales: boolean;
  enableOnlineRedemption: boolean;
  termsAndConditions?: string;
}

export interface CreateMembershipInput
  extends Omit<CreateMembershipDTO, "numberOfSessions" | "price" | "taxRate"> {
  numberOfSessions?: number | string;
  sessions?: string | number;
  price: number | string;
  taxRate?: number | string;
}

export interface UpdateMembershipDTO extends Partial<CreateMembershipDTO> {}

export interface UpdateMembershipInput
  extends Partial<Omit<CreateMembershipInput, "includedServices">> {
  includedServices?: IncludedService[];
}

export interface Membership extends CreateMembershipDTO {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipRow {
  id: string;
  name: string;
  description: string | null;
  session_type: string;
  number_of_sessions: number | null;
  valid_for: string;
  price: string;
  tax_rate: string | null;
  colour: string;
  enable_online_sales: boolean;
  enable_online_redemption: boolean;
  terms_and_conditions: string | null;
  created_at: Date;
  updated_at: Date;
  services: IncludedService[] | null;
}
