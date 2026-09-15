export type DigitalMenuStatus = "active" | "inactive";
export type DigitalMenuServiceMode = "all_active" | "specific";

export type DigitalMenu = {
  id: string;
  salon_id: string;
  name: string;
  status: DigitalMenuStatus;
  service_selection_mode: DigitalMenuServiceMode;
  public_token: string;
  created_at: string;
  updated_at: string;
};

// Enriched with counts computed at read time — never persisted columns.
export type DigitalMenuWithCounts = DigitalMenu & {
  selected_service_ids: string[];
  service_count: number;
  category_count: number;
};

export type SaveDigitalMenuBody = {
  name: string;
  status: DigitalMenuStatus;
  service_selection_mode: DigitalMenuServiceMode;
  selected_service_ids?: string[];
};

// ─── Public response (customer-facing) ─────────────────────────────────────────

export type PublicMenuService = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  price_type: string;
  duration: number;
  online_booking: boolean;
};

export type PublicMenuCategory = {
  name: string;
  services: PublicMenuService[];
};

export type PublicMenuResponse = {
  status: DigitalMenuStatus;
  name: string;
  salon: {
    name: string;
    logo_url: string | null;
    cover_image_url: string | null;
    phone: string | null;
    address: string | null;
  };
  currency: string | null;
  categories: PublicMenuCategory[];
  booking_slug: string | null;
};
