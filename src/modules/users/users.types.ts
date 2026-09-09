export type UserRole = "salon_owner" | "staff" | "client" | "admin";

export type AccessTokenPayload = {
    userId: string;
    email: string;
    role: UserRole;
    salonId?: string | null;
};

export type RefreshTokenPayload = {
    userId: string;
    tokenId: string;
};

export type SafeUser = {
    id: string;
    email: string;
    phone: string | null;
    firstName: string;
    lastName: string | null;
    fullName: string;
    role: UserRole;
    avatarUrl: string | null;
    isVerified: boolean;
    isActive: boolean;
    lastLogin: string | null;
    createdAt: string;
    updatedAt: string;
    // Extended profile fields
    businessName: string | null;
    address: string | null;
    country: string | null;
    countryCode: string | null;
    isOnboardingComplete: boolean;
    custom_permissions: Record<string, boolean> | null;
    /** Real-time resolved permission map (staff only) — see permission.middleware.ts's
     * getEffectivePermissionsForUser(). null for owner/admin/client, who don't need it. */
    effective_permissions: Record<string, boolean> | null;
};

export type { UpdateUserInput } from "./users.validator";
