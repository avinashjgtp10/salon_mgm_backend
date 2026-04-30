export type BlockedTime = {
  id: string;
  salon_id: string;
  staff_id: string;
  date: string;           // YYYY-MM-DD
  start_time: string;     // HH:MM
  end_time: string;       // HH:MM
  reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateBlockedTimeBody = {
  salon_id: string;
  staff_id: string;
  date: string;
  start_time: string;
  end_time: string;
  reason?: string;
};

export type UpdateBlockedTimeBody = Partial<Omit<CreateBlockedTimeBody, "salon_id">>;

export type BlockedTimeFilters = {
  salon_id?: string;
  staff_id?: string;
  date?: string;
};
