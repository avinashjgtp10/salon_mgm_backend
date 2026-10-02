export type RequirementStatus = "open" | "in_progress" | "completed";
export type RequirementPriority = "low" | "medium" | "high";
export type UpdateType = "internal_note" | "client_update" | "status_change";

export interface ClientRequirementRow {
  id: string;
  req_number: number;
  salon_id: string;
  user_id: string | null;
  title: string;
  description: string;
  priority: RequirementPriority;
  status: RequirementStatus;
  assigned_to: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  // Joined fields
  salon_name?: string;
  submitter_name?: string;
  submitter_email?: string;
  // Legacy single-assignee fields — kept for the older assign() endpoint,
  // superseded by the assignees[] array (multi-developer, set at creation).
  assignee_name?: string | null;
  assignee_email?: string | null;
  assignees?: RequirementAssignee[];
}

export interface RequirementAssignee {
  id: string;
  developer_id: string;
  developer_name: string;
  developer_email: string;
  role_label: string | null;
}

export interface RequirementUpdateRow {
  id: string;
  requirement_id: string;
  author_id: string | null;
  update_type: UpdateType;
  message: string;
  old_status: RequirementStatus | null;
  new_status: RequirementStatus | null;
  emailed_at: string | null;
  created_at: string;
  author_name?: string | null;
}

export interface CreateRequirementInput {
  salon_id: string;
  user_id?: string | null;
  title: string;
  description: string;
  priority: RequirementPriority;
  target_date?: string | null;
  status?: RequirementStatus;
  developers?: { developer_id: string; role_label?: string | null }[];
}

export interface ListRequirementsFilters {
  status?: RequirementStatus;
  priority?: RequirementPriority;
  search?: string;
}
