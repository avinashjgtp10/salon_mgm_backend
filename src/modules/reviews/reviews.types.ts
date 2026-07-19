export interface Review {
  id:              string
  salon_id:        string | null
  client_id:       string | null
  booking_id:      string | null
  staff_id:        string | null
  phone:           string | null
  rating:          number
  review_text:     string | null
  source:          "manual" | "whatsapp"
  wa_message_id:   string | null
  staff_rating:    number | null
  service_rating:  number | null
  ambience_rating: number | null
  is_verified:     boolean
  is_visible:      boolean
  response:        string | null
  responded_at:    string | null
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
