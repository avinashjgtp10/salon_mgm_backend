export type Setting = {
  id: string;
  salon_id: string;
  key: string;
  value: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateSettingBody = {
  key: string;
  value: string;
  description?: string;
};

export type UpdateSettingBody = {
  key?: string;
  value?: string;
  description?: string;
};
