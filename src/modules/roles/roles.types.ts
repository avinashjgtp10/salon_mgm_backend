export interface Permission {
    key: string;
    name: string;
    description: string | null;
    module: string;
    group_name: string | null;
    action: string;
    risk_level: "low" | "medium" | "high" | "critical";
    is_system: boolean;
    depends_on: string[] | null;
    display_order: number | null;
    created_at: string;
}

export interface Role {
    id: string;
    salon_id: string;
    name: string;
    description: string | null;
    is_default: boolean;
    created_at: string;
    updated_at: string;
}

export interface RoleWithPermissions extends Role {
    permissions: Record<string, boolean>;
    staff_count: number;
}

export interface CreateRoleBody {
    name: string;
    description?: string;
    permissions?: Record<string, boolean>;
}

export interface UpdateRoleBody {
    name?: string;
    description?: string;
    permissions?: Record<string, boolean>;
}

export interface EffectivePermission {
    key: string;
    roleDefault: boolean;
    override: boolean | null;
    effective: boolean;
}

export interface StaffPermissionsView {
    role: { id: string; name: string } | null;
    permissions: EffectivePermission[];
}

export interface SetStaffOverridesBody {
    // null clears that specific override (falls back to the role default for that key)
    overrides: Record<string, boolean | null>;
}

export interface AssignStaffRoleBody {
    role_id: string;
}

export interface BulkAssignRoleBody {
    staffIds: string[];
    roleId: string;
}

export interface BulkResetOverridesBody {
    staffIds: string[];
}
