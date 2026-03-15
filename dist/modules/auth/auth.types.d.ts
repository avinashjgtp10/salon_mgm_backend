export type RegisterBody = {
    fullName: string;
    businessName?: string;
    address?: string;
    email: string;
    country?: string;
    countryCode?: string;
    phone?: string;
    password: string;
    terms: boolean;
    role?: "salon_owner" | "staff" | "client" | "admin";
};
export type LoginBody = {
    email: string;
    password: string;
};
export type RefreshBody = {
    refreshToken: string;
};
export type LogoutBody = {
    refreshToken: string;
};
export type OAuthProvider = "google";
export type GoogleOAuthProfile = {
    provider: "google";
    providerUserId: string;
    email: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    emailVerified: boolean;
};
export type GoogleStatePayload = {
    codeVerifier: string;
    returnTo?: string;
    createdAt: number;
};
//# sourceMappingURL=auth.types.d.ts.map