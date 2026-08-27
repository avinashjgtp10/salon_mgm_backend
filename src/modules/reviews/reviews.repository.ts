import pool from "../../config/database"
import { Review, ReviewStats, ListReviewsFilters, ReviewServiceRating, ClientReviewEntry } from "./reviews.types"

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

  // Client History → "Feedback & Review" tab — every review this client has
  // submitted, each with its per-service breakdown attached (aggregated via
  // a correlated subquery rather than a join, since a review can have
  // several service_ratings rows and a plain join would duplicate the
  // parent review once per service).
  async listForClient(clientId: string, salonId: string): Promise<ClientReviewEntry[]> {
    const { rows } = await pool.query(
      `SELECT
         r.id, r.booking_id AS appointment_id,
         TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))) AS staff_name,
         r.rating, r.staff_rating, r.service_rating, r.ambience_rating,
         r.improvement_tags, r.additional_comments, r.created_at,
         COALESCE((
           SELECT json_agg(json_build_object(
             'service_name', sr.service_name,
             'staff_name',   sr.staff_name,
             'rating',       sr.rating,
             'comment',      sr.comment
           ) ORDER BY sr.created_at)
           FROM review_service_ratings sr
           WHERE sr.review_id = r.id
         ), '[]'::json) AS service_ratings
       FROM reviews r
       LEFT JOIN staff st ON st.id = r.staff_id
       WHERE r.client_id = $1 AND r.salon_id = $2
       ORDER BY r.created_at DESC`,
      [clientId, salonId]
    )
    return rows.map((row: any) => ({
      ...row,
      staff_name: row.staff_name?.trim() || null,
    }))
  },
}
