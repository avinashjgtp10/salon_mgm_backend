export interface Review {
  id:                   string
  salon_id:             string | null
  client_id:            string | null
  booking_id:           string | null
  staff_id:             string | null
  phone:                string | null
  rating:               number
  review_text:          string | null
  source:               "manual" | "whatsapp"
  wa_message_id:        string | null
  staff_rating:         number | null
  service_rating:       number | null
  ambience_rating:      number | null
  // Public feedback-form fields — overall_rating mirrors `rating` (kept in
  // sync at write time) so existing reporting that reads `rating` directly
  // keeps working; improvement_tags is a closed-enum multi-select (see
  // IMPROVEMENT_TAGS), additional_comments is the form's final free-text box.
  overall_rating:       number | null
  improvement_tags:     string[] | null
  additional_comments:  string | null
  is_verified:          boolean
  is_visible:           boolean
  response:             string | null
  responded_at:         string | null
  created_at:           string
}

// Fixed enum for the public feedback form's "What can we improve?" checklist —
// submitPublicFeedback() rejects any improvementTags value outside this set.
export const IMPROVEMENT_TAGS = [
  "Waiting Time",
  "Staff Behaviour",
  "Service Quality",
  "Cleanliness",
  "Ambience",
  "Pricing",
  "Reception",
  "Other",
] as const

export type ImprovementTag = typeof IMPROVEMENT_TAGS[number]

// One row per rated service line in an appointment — service_row_id matches
// the `id` on an item inside appointments.services JSONB (not a FK, since
// JSONB array items aren't relational rows; same pattern as
// appointment_service_consumables.service_row_id). staff_id/staff_name/
// service_name are denormalized from that JSONB at submit time.
export interface ReviewServiceRating {
  id:              string
  review_id:       string
  appointment_id:  string
  service_row_id:  string
  service_id:      string | null
  service_name:    string
  staff_id:        string | null
  staff_name:      string | null
  rating:          number
  comment:         string | null
  created_at:      string
}

export interface ReviewStats {
  averageRating: number
  totalReviews:  number
}

export interface ListReviewsFilters {
  staffId?: string
  page?:    number
  limit?:   number
}

export type WaReviewPromptStatus = "PENDING_REPLY" | "RATED" | "LIST_SEND_FAILED"

export interface WaReviewPrompt {
  id:                    string
  salon_id:              string
  client_id:             string | null
  phone:                 string
  appointment_id:        string | null
  staff_id:              string | null
  review_request_wamid:  string | null
  opt_in_wamid:          string | null
  list_prompt_wamid:     string | null
  status:                WaReviewPromptStatus
  rating:                number | null
  review_id:             string | null
  created_at:             string
  updated_at:             string
  rated_at:               string | null
}
