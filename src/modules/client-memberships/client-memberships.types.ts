export interface ClientMembership {
  id: string;
  salonId: string;
  clientId: string;
  clientName: string;
  mobile?: string;
  email?: string;
  membershipId: string;
  membershipName: string;
  colour?: string;
  totalSessions: number;    // 0 = unlimited
  usedSessions: number;
  remainingSessions: number;
  purchasedAt: string;
  expiresAt?: string;
  status: 'active' | 'expired' | 'exhausted' | 'cancelled';
  pricePaid?: number;
  usageLog?: UsageLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface UsageLogEntry {
  id: string;
  clientMembershipId: string;
  appointmentId?: string;
  serviceName?: string;
  sessionsConsumed: number;
  notes?: string;
  usedAt: string;
}

export interface CreateClientMembershipDTO {
  clientId: string;
  membershipId: string;
  membershipName: string;
  colour?: string;
  totalSessions: number;
  expiresAt?: string;
  pricePaid?: number;
  notes?: string;
}

export interface ConsumeSessionDTO {
  appointmentId?: string;
  serviceName?: string;
  sessionsToConsume?: number;
  notes?: string;
}

export interface ClientMembershipsListQuery {
  clientId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

// ── DB row types ──────────────────────────────────────────────────────────────
export interface ClientMembershipRow {
  id: string;
  salon_id: string;
  client_id: string;
  client_name: string;
  mobile?: string | null;
  email?: string | null;
  membership_id: string;
  membership_name: string;
  colour?: string | null;
  total_sessions: number;
  used_sessions: number;
  purchased_at: string;
  expires_at?: string | null;
  status: string;
  price_paid?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageLogRow {
  id: string;
  client_membership_id: string;
  appointment_id?: string | null;
  service_name?: string | null;
  sessions_consumed: number;
  notes?: string | null;
  used_at: string;
}
