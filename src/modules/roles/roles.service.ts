import { AppError } from "../../middleware/error.middleware";
import {
    staffHasPermission,
    PermUser,
    invalidateStaffRoleCache,
    invalidateRolePermissionsCache,
    invalidateStaffOverridesCache,
} from "../../middleware/permission.middleware";
import { rolesRepository } from "./roles.repository";
import {
    Permission,
    Role,
    RoleWithPermissions,
    CreateRoleBody,
    UpdateRoleBody,
    EffectivePermission,
    StaffPermissionsView,
} from "./roles.types";

interface ActorContext {
    userId: string;
    role?: string;
    salonId?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
}

// ── Anti-escalation ──────────────────────────────────────────────────────────
// A manage_roles holder can never grant a role/permission they do not
// themselves effectively hold. Owner/admin are exempt (they already have
// unconditional full access everywhere else in the app). Checked against
// every key the caller is trying to set to `true` — keys being turned off,
// or already false, never need escalation.
async function assertNoEscalation(actor: ActorContext, keysBeingGrantedTrue: string[]): Promise<void> {
    if (actor.role === "salon_owner" || actor.role === "admin") return;
    if (keysBeingGrantedTrue.length === 0) return;
    if (!actor.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

    const actorPermUser: PermUser = { userId: actor.userId, role: actor.role, salonId: actor.salonId };
    for (const key of keysBeingGrantedTrue) {
        const actorHasIt = await staffHasPermission(actorPermUser, key);
        if (!actorHasIt) {
            throw new AppError(
                403,
                `You cannot grant a permission you do not have yourself: ${key}`,
                "ESCALATION_FORBIDDEN"
            );
        }
    }
}

// Finds an existing role by name for this salon, or creates it blank (every
// permission false) — deliberately NOT seeded from DEFAULT_STAFF_PERMS. Once
// a staff member is touched through the new system at all, they should be on
// an explicit-grant model, not silently inheriting the old legacy defaults.
async function ensureDefaultRole(salonId: string, name: string): Promise<string> {
    const existing = await rolesRepository.findRoleByName(salonId, name);
    if (existing) return existing.id;
    const created = await rolesRepository.createRole(salonId, name, `Default ${name} role`);
    return created.id;
}

export const rolesService = {
    // ── Permission catalog ───────────────────────────────────────────────────
    async listPermissions(): Promise<Permission[]> {
        return rolesRepository.listPermissions();
    },

    // ── Audit log ────────────────────────────────────────────────────────────
    async listAuditLog(salonId: string, filters: { targetStaffId?: string; limit?: number; cursor?: string }) {
        return rolesRepository.listAuditLog(salonId, filters);
    },

    // ── Roles ────────────────────────────────────────────────────────────────
    async listRoles(salonId: string): Promise<(Role & { staff_count: number })[]> {
        return rolesRepository.listRoles(salonId);
    },

    async getRoleWithPermissions(id: string, salonId: string): Promise<RoleWithPermissions> {
        const role = await rolesRepository.findRoleById(id, salonId);
        if (!role) throw new AppError(404, "Role not found", "NOT_FOUND");
        const permissions = await rolesRepository.getRolePermissions(id);
        return { ...role, permissions };
    },

    async createRole(salonId: string, actor: ActorContext, body: CreateRoleBody): Promise<RoleWithPermissions> {
        if (!body.name || !body.name.trim()) {
            throw new AppError(400, "name is required", "VALIDATION_ERROR");
        }
        const existing = await rolesRepository.findRoleByName(salonId, body.name.trim());
        if (existing) throw new AppError(409, "A role with this name already exists", "DUPLICATE_ROLE_NAME");

        const permissions = body.permissions ?? {};
        const grantedTrueKeys = Object.entries(permissions).filter(([, v]) => v === true).map(([k]) => k);
        await assertNoEscalation(actor, grantedTrueKeys);

        const role = await rolesRepository.createRole(salonId, body.name.trim(), body.description ?? null);
        for (const [key, allowed] of Object.entries(permissions)) {
            await rolesRepository.setRolePermission(role.id, key, allowed);
        }
        invalidateRolePermissionsCache(role.id);

        await rolesRepository.insertAuditLog({
            salonId,
            actorUserId: actor.userId,
            targetType: "role",
            targetId: role.id,
            action: "role_created",
            beforeValue: null,
            afterValue: { name: role.name, permissions },
            source: "role_edit",
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        });

        return { ...role, permissions, staff_count: 0 };
    },

    async updateRole(id: string, salonId: string, actor: ActorContext, body: UpdateRoleBody): Promise<RoleWithPermissions> {
        const existing = await rolesRepository.findRoleById(id, salonId);
        if (!existing) throw new AppError(404, "Role not found", "NOT_FOUND");

        if (body.name !== undefined && body.name.trim() !== existing.name) {
            const clash = await rolesRepository.findRoleByName(salonId, body.name.trim());
            if (clash && clash.id !== id) throw new AppError(409, "A role with this name already exists", "DUPLICATE_ROLE_NAME");
        }

        const beforePermissions = await rolesRepository.getRolePermissions(id);

        if (body.permissions) {
            const grantedTrueKeys = Object.entries(body.permissions)
                .filter(([key, v]) => v === true && beforePermissions[key] !== true)
                .map(([key]) => key);
            await assertNoEscalation(actor, grantedTrueKeys);
        }

        await rolesRepository.updateRole(id, salonId, {
            name: body.name?.trim(),
            description: body.description,
        });

        if (body.permissions) {
            invalidateRolePermissionsCache(id);
            for (const [key, allowed] of Object.entries(body.permissions)) {
                if (beforePermissions[key] !== allowed) {
                    await rolesRepository.setRolePermission(id, key, allowed);
                    await rolesRepository.insertAuditLog({
                        salonId,
                        actorUserId: actor.userId,
                        targetType: "role",
                        targetId: id,
                        action: allowed ? "permission_granted" : "permission_revoked",
                        permissionKey: key,
                        beforeValue: beforePermissions[key] ?? false,
                        afterValue: allowed,
                        source: "role_edit",
                        ipAddress: actor.ipAddress,
                        userAgent: actor.userAgent,
                    });
                }
            }
        }

        return this.getRoleWithPermissions(id, salonId);
    },

    async deleteRole(id: string, salonId: string, reassignToRoleId?: string): Promise<void> {
        const role = await rolesRepository.findRoleById(id, salonId);
        if (!role) throw new AppError(404, "Role not found", "NOT_FOUND");

        const staffCount = await rolesRepository.countStaffForRole(id);
        if (staffCount > 0) {
            if (!reassignToRoleId) {
                throw new AppError(
                    409,
                    `${staffCount} staff member(s) are assigned to this role — pass reassign_to to move them first, or reassign them manually before deleting`,
                    "ROLE_HAS_STAFF"
                );
            }
            const target = await rolesRepository.findRoleById(reassignToRoleId, salonId);
            if (!target) throw new AppError(404, "reassign_to role not found", "NOT_FOUND");
            await rolesRepository.reassignStaffRole(id, reassignToRoleId);
        }

        await rolesRepository.deleteRole(id, salonId);
    },

    async duplicateRole(id: string, salonId: string, actor: ActorContext): Promise<RoleWithPermissions> {
        const source = await this.getRoleWithPermissions(id, salonId);
        let copyName = `${source.name} (copy)`;
        let suffix = 2;
        while (await rolesRepository.findRoleByName(salonId, copyName)) {
            copyName = `${source.name} (copy ${suffix})`;
            suffix++;
        }
        return this.createRole(salonId, actor, {
            name: copyName,
            description: source.description ?? undefined,
            permissions: source.permissions,
        });
    },

    // ── Staff effective permissions / overrides / role assignment ───────────
    async getStaffEffectivePermissions(staffId: string, salonId: string): Promise<StaffPermissionsView> {
        const staff = await rolesRepository.getStaffRoleId(staffId, salonId);
        if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

        const catalog = await rolesRepository.listPermissions();
        const overrides = await rolesRepository.getStaffOverrides(staffId);

        let roleDefaults: Record<string, boolean> = {};
        let roleInfo: { id: string; name: string } | null = null;
        if (staff.role_id) {
            const role = await rolesRepository.findRoleById(staff.role_id, salonId);
            if (role) {
                roleInfo = { id: role.id, name: role.name };
                roleDefaults = await rolesRepository.getRolePermissions(staff.role_id);
            }
        }

        const permissions: EffectivePermission[] = catalog.map((perm) => {
            const roleDefault = roleDefaults[perm.key] ?? false;
            const override = perm.key in overrides ? overrides[perm.key] : null;
            return {
                key: perm.key,
                roleDefault,
                override,
                effective: override !== null ? override : roleDefault,
            };
        });

        return { role: roleInfo, permissions };
    },

    async setStaffOverrides(
        staffId: string,
        salonId: string,
        actor: ActorContext,
        overrides: Record<string, boolean | null>
    ): Promise<StaffPermissionsView> {
        let staff = await rolesRepository.getStaffRoleId(staffId, salonId);
        if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

        // An override with no role behind it is inert — permission.middleware.ts's
        // resolver only ever consults staff_permission_overrides once role_id is
        // set, otherwise it falls through to the legacy blob/DEFAULT_STAFF_PERMS
        // path, silently ignoring whatever was just saved here. Auto-assign the
        // default "Staff" role (creating it, blank, if this salon doesn't have one
        // yet) so an override set through this endpoint is never a no-op.
        if (!staff.role_id) {
            const defaultRoleId = await ensureDefaultRole(salonId, "Staff");
            await rolesRepository.assignStaffRole(staffId, defaultRoleId);
            staff = { ...staff, role_id: defaultRoleId };
            if (staff.user_id) invalidateStaffRoleCache(staff.user_id);
        }

        const grantedTrueKeys = Object.entries(overrides).filter(([, v]) => v === true).map(([k]) => k);
        await assertNoEscalation(actor, grantedTrueKeys);

        const before = await rolesRepository.getStaffOverrides(staffId);

        for (const [key, allowed] of Object.entries(overrides)) {
            const prev = key in before ? before[key] : null;
            if (prev === allowed) continue; // no real change — skip the write and the audit row
            await rolesRepository.setStaffOverride(staffId, key, allowed, actor.userId);
            await rolesRepository.insertAuditLog({
                salonId,
                actorUserId: actor.userId,
                targetType: "staff",
                targetId: staffId,
                action: allowed === null ? "override_reset" : allowed ? "permission_granted" : "permission_revoked",
                permissionKey: key,
                beforeValue: prev,
                afterValue: allowed,
                source: "individual_override",
                ipAddress: actor.ipAddress,
                userAgent: actor.userAgent,
            });
        }
        invalidateStaffOverridesCache(staffId);

        return this.getStaffEffectivePermissions(staffId, salonId);
    },

    async resetStaffOverrides(staffId: string, salonId: string, actor: ActorContext): Promise<StaffPermissionsView> {
        const staff = await rolesRepository.getStaffRoleId(staffId, salonId);
        if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

        const before = await rolesRepository.getStaffOverrides(staffId);
        await rolesRepository.deleteAllStaffOverrides(staffId);
        invalidateStaffOverridesCache(staffId);

        if (Object.keys(before).length > 0) {
            await rolesRepository.insertAuditLog({
                salonId,
                actorUserId: actor.userId,
                targetType: "staff",
                targetId: staffId,
                action: "override_reset",
                beforeValue: before,
                afterValue: null,
                source: "individual_override",
                ipAddress: actor.ipAddress,
                userAgent: actor.userAgent,
            });
        }

        return this.getStaffEffectivePermissions(staffId, salonId);
    },

    async assignStaffRole(staffId: string, salonId: string, actor: ActorContext, roleId: string): Promise<StaffPermissionsView> {
        const staff = await rolesRepository.getStaffRoleId(staffId, salonId);
        if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

        const targetRole = await rolesRepository.findRoleById(roleId, salonId);
        if (!targetRole) throw new AppError(404, "Role not found", "NOT_FOUND");

        const targetRolePerms = await rolesRepository.getRolePermissions(roleId);
        const grantedTrueKeys = Object.entries(targetRolePerms).filter(([, v]) => v === true).map(([k]) => k);
        await assertNoEscalation(actor, grantedTrueKeys);

        const beforeRoleId = staff.role_id;
        await rolesRepository.assignStaffRole(staffId, roleId);
        if (staff.user_id) invalidateStaffRoleCache(staff.user_id);

        await rolesRepository.insertAuditLog({
            salonId,
            actorUserId: actor.userId,
            targetType: "staff",
            targetId: staffId,
            action: "role_assigned",
            beforeValue: beforeRoleId,
            afterValue: roleId,
            source: "role_assignment",
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        });

        return this.getStaffEffectivePermissions(staffId, salonId);
    },

    async bulkAssignRole(staffIds: string[], salonId: string, actor: ActorContext, roleId: string): Promise<void> {
        for (const staffId of staffIds) {
            await this.assignStaffRole(staffId, salonId, actor, roleId);
        }
    },

    async bulkResetOverrides(staffIds: string[], salonId: string, actor: ActorContext): Promise<void> {
        for (const staffId of staffIds) {
            await this.resetStaffOverrides(staffId, salonId, actor);
        }
    },
};
