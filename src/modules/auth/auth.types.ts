export type RegisterBody = {
  email: string;
  phone?: string;
  password: string;
  first_name: string;
  last_name?: string;
  role: "salon_owner" | "staff" | "client" | "admin";
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
