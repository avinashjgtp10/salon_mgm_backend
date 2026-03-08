// ─── Enums ────────────────────────────────────────────────────────────────────

export type Amenity =
  | "parking_available"
  | "near_public_transport"
  | "showers"
  | "lockers"
  | "bath_towels"
  | "swimming_pool"
  | "sauna";

export type Highlight =
  | "pet_friendly"
  | "adults_only"
  | "kid_friendly"
  | "wheelchair_accessible";

export type Value =
  | "organic_products_only"
  | "vegan_products_only"
  | "environmentally_friendly"
  | "lgbtq_plus"
  | "black_owned"
  | "woman_owned"
  | "asian_owned"
  | "hispanic_owned"
  | "indigenous_owned";

export type FeatureType = "amenity" | "highlight" | "value";

// ─── Marketplace Profile ──────────────────────────────────────────────────────

export type MarketplaceProfile = {
  id: string;
  salon_id: string;
  // Essentials
  display_name: string;
  business_phone: string | null;
  business_phone_country_code: string | null;
  business_email: string | null;
  // About
  venue_description: string | null;
  // Status
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export type UpsertEssentialsBody = {
  display_name: string;
  business_phone?: string | null;
  business_phone_country_code?: string | null;
  business_email?: string | null;
};

export type UpsertAboutBody = {
  venue_description: string;
};

// ─── Business Location ────────────────────────────────────────────────────────

export type MarketplaceLocation = {
  id: string;
  profile_id: string;
  address_line: string;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
};

export type UpsertLocationBody = {
  address_line: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

// ─── Working Hours ────────────────────────────────────────────────────────────

export type WorkingHourSlot = {
  open_time: string;   // "10:00:00"
  close_time: string;  // "19:00:00"
};

export type WorkingHoursDay = {
  day_of_week: number; // 0=Sun, 1=Mon ... 6=Sat
  is_open: boolean;
  slots: WorkingHourSlot[];
};

export type MarketplaceWorkingHour = {
  id: string;
  profile_id: string;
  day_of_week: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  slot_index: number;
  created_at: string;
  updated_at: string;
};

export type UpsertWorkingHoursBody = {
  days: WorkingHoursDay[];
};

// ─── Venue Images ─────────────────────────────────────────────────────────────

export type MarketplaceImage = {
  id: string;
  profile_id: string;
  image_url: string;
  is_cover: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AddImageBody = {
  image_url: string;
  is_cover?: boolean;
};

export type ReorderImagesBody = {
  image_ids: string[]; // ordered list of IDs
};

// ─── Features ─────────────────────────────────────────────────────────────────

export type MarketplaceFeature = {
  id: string;
  profile_id: string;
  feature_type: FeatureType;
  feature_key: string;
  created_at: string;
};

export type UpsertFeaturesBody = {
  amenities?: Amenity[];
  highlights?: Highlight[];
  values?: Value[];
};

// ─── Full Profile (aggregated) ────────────────────────────────────────────────

export type MarketplaceProfileFull = MarketplaceProfile & {
  location: MarketplaceLocation | null;
  working_hours: WorkingHoursDay[];
  images: MarketplaceImage[];
  amenities: Amenity[];
  highlights: Highlight[];
  values: Value[];
};