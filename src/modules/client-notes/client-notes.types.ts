export type ClientNote = {
  id: string;
  salon_id: string;
  client_id: string;
  staff_id: string | null;
  staff_name: string | null;
  note: string;
  created_at: string;
  updated_at: string;
};

export type CreateClientNoteBody = {
  note: string;
  // Sent by the frontend from the logged-in staff member's own session state —
  // avoids this module needing its own staff-lookup dependency just to label
  // a note (same convention as staff_name fields elsewhere in the codebase,
  // e.g. membership_usage_log's staff_name).
  staff_name?: string;
};

export type UpdateClientNoteBody = {
  note: string;
};
