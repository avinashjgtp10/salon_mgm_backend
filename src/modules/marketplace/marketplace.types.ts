export type PartnerStatus = 'pending' | 'approved' | 'rejected';

export type WorkingHoursDay = {
  open: boolean;
  start: string; // "HH:MM"
  end: string;
};

export type WorkingHours = {
  mon: WorkingHoursDay;
  tue: WorkingHoursDay;
  wed: WorkingHoursDay;
  thu: WorkingHoursDay;
  fri: WorkingHoursDay;
  sat: WorkingHoursDay;
  sun: WorkingHoursDay;
};

export type MarketplaceListing = {
  id: string;
  salon_id: string;
  display_name: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  tags: string[];
  amenities: string[];
  highlights: string[];
  images: string[];
  cover_image: string | null;
  working_hours: WorkingHours | null;
  status: PartnerStatus;
  is_published: boolean;
  avg_rating: number;
  total_reviews: number;
  created_at: string;
  updated_at: string;
};

export type MarketplaceReview = {
  id: string;
  listing_id: string;
  customer_phone: string;
  customer_name: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
};

export type MarketplaceBooking = {
  id: string;
  listing_id: string;
  salon_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  service_id: string | null;       // ← NEW: references services.id
  staff_id: string | null;         // ← NEW: references staff.id
  service_name: string;            // kept for display / backwards compat
  staff_name: string | null;       // kept for display / backwards compat
  price: number;                   // ← NEW: actual price at time of booking
  booking_date: string;
  booking_time: string;
  duration_minutes: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Request body types
export type CreateListingBody = {
  display_name: string;
  description?: string;
  phone?: string;
  email?: string;
  city?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  category?: string;
  tags?: string[];
  amenities?: string[];
  highlights?: string[];
  working_hours?: WorkingHours;
};

export type UpdateListingBody = Partial<CreateListingBody>;

export type CreateBookingBody = {
  listing_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  service_id?: string;       // ← NEW
  staff_id?: string;         // ← NEW
  service_name: string;      // still required — display fallback
  staff_name?: string;       // still sent — display fallback
  price?: number;            // ← NEW
  booking_date: string;
  booking_time: string;
  duration_minutes?: number;
  notes?: string;
};

export type CreateReviewBody = {
  listing_id: string;
  customer_phone: string;
  customer_name?: string;
  rating: number;
  comment?: string;
};