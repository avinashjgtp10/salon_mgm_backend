import pool from "../../config/database"
import { Review, ReviewStats, ListReviewsFilters, ReviewServiceRating } from "./reviews.types"

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

  // Public feedback-form submission — keyed by appointment (booking_id), not
  // a wa_message_id, since this path has no WhatsApp message to anchor to.
  // Idempotent: re-opening/double-tapping the same link updates the same row
  // instead of inserting a duplicate (see idx_reviews_booking_id_uq).
  // `rating`/`review_text` mirror `overall_rating`/`additional_comments` so
  // existing reporting that reads `rating` directly keeps working unchanged.
  async upsertRatingForAppointment(params: {
    salonId:            string
    clientId:           string | null
    phone:              string | null
    staffId:            string | null
    appointmentId:      string
    overallRating:      number
    improvementTags:    string[]
    additionalComments: string | null
  }): Promise<Review> {
    const { rows } = await pool.query(
      `INSERT INTO reviews
         (salon_id, client_id, phone, staff_id, booking_id, rating, review_text, source,
          overall_rating, improvement_tags, additional_comments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'whatsapp', $8, $9, $10)
       ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL
       DO UPDATE SET rating = EXCLUDED.rating, review_text = EXCLUDED.review_text, staff_id = EXCLUDED.staff_id,
                      overall_rating = EXCLUDED.overall_rating, improvement_tags = EXCLUDED.improvement_tags,
                      additional_comments = EXCLUDED.additional_comments
       RETURNING *`,
      [
        params.salonId, params.clientId, params.phone, params.staffId, params.appointmentId,
        params.overallRating, params.additionalComments,
        params.overallRating, params.improvementTags, params.additionalComments,
      ]
    )
    return rows[0]
  },

  // Per-service ratings for one appointment's feedback submission. Replaces
  // the full set on every call (delete-then-insert) rather than a per-row
  // upsert — simplest correct idempotency for a re-submit, same "current
  // state, not an append-only log" semantics as appointment_service_consumables.
  async upsertServiceRatings(
    reviewId: string,
    appointmentId: string,
    ratings: Array<{
      serviceRowId: string
      serviceId:    string | null
      serviceName:  string
      staffId:      string | null
      staffName:    string | null
      rating:       number
      comment:      string | null
    }>
  ): Promise<ReviewServiceRating[]> {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(`DELETE FROM review_service_ratings WHERE appointment_id = $1`, [appointmentId])

      const inserted: ReviewServiceRating[] = []
      for (const r of ratings) {
        const { rows } = await client.query(
          `INSERT INTO review_service_ratings
             (review_id, appointment_id, service_row_id, service_id, service_name, staff_id, staff_name, rating, comment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [reviewId, appointmentId, r.serviceRowId, r.serviceId, r.serviceName, r.staffId, r.staffName, r.rating, r.comment]
        )
        inserted.push(rows[0])
      }

      await client.query("COMMIT")
      return inserted
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }
  },
}
