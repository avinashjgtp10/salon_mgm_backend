export type UserRole = "salon_owner" | "staff" | "client" | "admin";

export type AccessTokenPayload = {
    userId: string;
    email: string;
    role: UserRole;
    salonId?: string | null; // you can add later
};

export type RefreshTokenPayload = {
    userId: string;
    tokenId: string; // refresh_tokens.id
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
