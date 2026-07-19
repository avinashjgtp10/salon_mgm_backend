import pool from "../../config/database"
import { Review, ReviewStats, ListReviewsFilters, WaReviewPrompt } from "./reviews.types"

export const reviewsRepository = {

  // ── Final captured ratings (reviews table) ──────────────────────────────

  async list(salonId: string, filters: ListReviewsFilters): Promise<{ data: Review[]; total: number }> {
    const page   = Math.max(1, filters.page ?? 1)
    const limit  = Math.min(100, Math.max(1, filters.limit ?? 20))
    const offset = (page - 1) * limit

    const params: any[] = [salonId]
    let staffFilter = ""
    if (filters.staffId) {
      params.push(filters.staffId)
      staffFilter = `AND staff_id = $${params.length}`
    }

    const { rows: [countRow] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM reviews WHERE salon_id = $1 ${staffFilter}`,
      params
    )

    params.push(limit, offset)
    const { rows } = await pool.query(
      `SELECT * FROM reviews WHERE salon_id = $1 ${staffFilter}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    return { data: rows, total: countRow?.total ?? 0 }
  },

  async getStats(salonId: string, staffId?: string): Promise<ReviewStats> {
    const params: any[] = [salonId]
    let staffFilter = ""
    if (staffId) {
      params.push(staffId)
      staffFilter = `AND staff_id = $${params.length}`
    }
    const { rows: [row] } = await pool.query(
      `SELECT COALESCE(AVG(rating), 0)::numeric(3,2) AS avg_rating, COUNT(*)::int AS total
       FROM reviews WHERE salon_id = $1 ${staffFilter}`,
      params
    )
    return { averageRating: Number(row?.avg_rating ?? 0), totalReviews: row?.total ?? 0 }
  },

  async insertRating(params: {
    salonId:    string
    clientId:   string | null
    phone:      string
    staffId:    string | null
    rating:     number
    waMessageId: string
  }): Promise<Review> {
    const { rows } = await pool.query(
      `INSERT INTO reviews (salon_id, client_id, phone, staff_id, rating, source, wa_message_id)
       VALUES ($1, $2, $3, $4, $5, 'whatsapp', $6)
       RETURNING *`,
      [params.salonId, params.clientId, params.phone, params.staffId, params.rating, params.waMessageId]
    )
    return rows[0]
  },

  // ── In-flight prompt tracking (wa_review_prompts table) ─────────────────

  async createPrompt(params: {
    salonId:             string
    clientId:            string | null
    phone:               string
    appointmentId:       string | null
    staffId:             string | null
    reviewRequestWamid:  string | null
    optInWamid:          string | null
    listPromptWamid:     string | null
  }): Promise<WaReviewPrompt> {
    const { rows } = await pool.query(
      `INSERT INTO wa_review_prompts
         (salon_id, client_id, phone, appointment_id, staff_id,
          review_request_wamid, opt_in_wamid, list_prompt_wamid, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING_REPLY')
       RETURNING *`,
      [
        params.salonId, params.clientId, params.phone, params.appointmentId, params.staffId,
        params.reviewRequestWamid, params.optInWamid, params.listPromptWamid,
      ]
    )
    return rows[0]
  },

  async findPromptByListWamid(wamid: string): Promise<WaReviewPrompt | null> {
    const { rows } = await pool.query(
      `SELECT * FROM wa_review_prompts WHERE list_prompt_wamid = $1 AND status = 'PENDING_REPLY'`,
      [wamid]
    )
    return rows[0] ?? null
  },

  async findMostRecentPendingPrompt(salonId: string, phone: string): Promise<WaReviewPrompt | null> {
    const { rows } = await pool.query(
      `SELECT * FROM wa_review_prompts
       WHERE salon_id = $1 AND phone = $2 AND status = 'PENDING_REPLY'
       ORDER BY created_at DESC LIMIT 1`,
      [salonId, phone]
    )
    return rows[0] ?? null
  },

  // Atomic conditional transition — 0 rows back means it was already rated
  // (double-tap or a redelivered webhook), caller must not insert a second review.
  async markRated(promptId: string, rating: number): Promise<WaReviewPrompt | null> {
    const { rows } = await pool.query(
      `UPDATE wa_review_prompts
       SET status = 'RATED', rating = $1, rated_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'PENDING_REPLY'
       RETURNING *`,
      [rating, promptId]
    )
    return rows[0] ?? null
  },

  async setReviewId(promptId: string, reviewId: string): Promise<void> {
    await pool.query(
      `UPDATE wa_review_prompts SET review_id = $1, updated_at = NOW() WHERE id = $2`,
      [reviewId, promptId]
    )
  },

  async findAppointmentStaffId(appointmentId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT staff_id FROM appointments WHERE id = $1`,
      [appointmentId]
    )
    return rows[0]?.staff_id ?? null
  },
}
