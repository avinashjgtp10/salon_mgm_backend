// Catalog → Tool Tracking. See Migration/create_tool_tracking.sql.

export const ASSET_CONDITIONS = ["new", "good", "fair", "damaged"] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const ASSET_STATUSES = ["available", "issued", "under_maintenance", "missing", "retired"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const INCIDENT_TYPES = ["damaged", "missing"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INVESTIGATION_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number];

export type AssetEventType =
  | "registered" | "updated" | "issued" | "returned" | "transferred" | "condition_changed"
  | "damage_reported" | "missing_reported" | "incident_updated" | "found"
  | "maintenance_started" | "maintenance_completed" | "inspection_cleared" | "retired";

export interface Asset {
  id: string;
  salon_id: string;
  branch_id: string | null;
  branch_name?: string | null;
  asset_seq: number;
  asset_code: string;
  name: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  photo_url: string | null;
  icon: string | null;
  receipt_url: string | null;
  warranty_card_url: string | null;
  condition: AssetCondition;
  status: AssetStatus;
  needs_inspection: boolean;
  current_staff_id: string | null;
  current_staff_name?: string | null;
  issued_at: string | null;
  expected_return_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetEvent {
  id: string;
  asset_id: string;
  event_type: AssetEventType;
  staff_id: string | null;
  staff_name?: string | null;
  branch_id: string | null;
  branch_name?: string | null;
  from_branch_id: string | null;
  from_branch_name?: string | null;
  condition: AssetCondition | null;
  from_condition: AssetCondition | null;
  status_after: AssetStatus | null;
  expected_return_at: string | null;
  incident_id: string | null;
  notes: string | null;
  occurred_at: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
}

export interface AssetIncident {
  id: string;
  asset_id: string;
  asset_code?: string;
  asset_name?: string;
  incident_type: IncidentType;
  reported_at: string;
  last_staff_id: string | null;
  last_staff_name?: string | null;
  last_condition: AssetCondition | null;
  description: string;
  photo_url: string | null;
  reported_by: string | null;
  reported_by_name?: string | null;
  investigation_status: InvestigationStatus;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

export interface AssetListFilters {
  search?: string;
  // Each filter takes several values (comma-separated in the query string).
  status?: AssetStatus[];
  condition?: AssetCondition[];
  category?: string[];
  brand?: string[];
  branch_id?: string[];
  page?: number;
  limit?: number;
}

export interface Actor {
  userId: string;
  salonId: string;
}
