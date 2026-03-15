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
    role: UserRole;
    avatarUrl: string | null;
    isVerified: boolean;
    isActive: boolean;
    lastLogin: string | null;
    createdAt: string;
    updatedAt: string;
};
export type { UpdateUserInput } from "./users.validator";
//# sourceMappingURL=users.types.d.ts.map