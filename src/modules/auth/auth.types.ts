// REGISTER

export type RegisterBody = {
  fullName: string;          // full name from frontend
  businessName?: string;     // salon/business name
  address?: string;
  email: string;
  country?: string;
  countryCode?: string;
  phone?: string;
  password: string;
  terms: boolean;

  // role should NOT come from frontend normally
  role?: "salon_owner" | "staff" | "client" | "admin";
};


// LOGIN

export type LoginBody = {
  email: string;
  password: string;
};


// REFRESH TOKEN

export type RefreshBody = {
  refreshToken: string;
};


// LOGOUT

export type LogoutBody = {
  refreshToken: string;
};


// ===================== GOOGLE OAUTH =====================

export type OAuthProvider = "google";

export type GoogleOAuthProfile = {
  provider: "google";
  providerUserId: string; // google sub
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
