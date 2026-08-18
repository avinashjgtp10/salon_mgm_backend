export interface SalonGroupMemberSalon {
  id: string;
  name: string;
  status: string;
  plan_name: string | null;
}

export interface SalonGroup {
  id: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  name: string;
  created_at: string;
  updated_at: string;
  salons: SalonGroupMemberSalon[];
}

export interface CreateSalonGroupBody {
  name: string;
  owner_id: string;
}

export interface AddSalonToGroupBody {
  salon_id: string;
}

// Full salon card shown in the Group Admin mini-panel — same field set as
// Super Admin's own salon list (super-admin.repository.ts::getAllSalons),
// but scoped server-side to the caller's own group only.
export interface GroupAdminSalonCard {
  id: string;
  name: string;
  status: string;
  plan_name: string | null;
  staff_count: number;
  client_count: number;
  revenue: number;
  created_at: string;
}

export interface SetGroupCredentialsBody {
  email: string;
  password: string;
}

// Combined totals across every salon in a group — the rollup shown at the
// top of the Group Admin dashboard.
export interface GroupSummary {
  salon_count: number;
  total_staff: number;
  total_clients: number;
  total_appointments: number;
  total_revenue: number;
}
