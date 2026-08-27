import { reviewsRepository } from "./reviews.repository"
import { appointmentsRepository } from "../appointments/appointments.repository"
import { salonsRepository } from "../salons/salons.repository"
import { AppError } from "../../middleware/error.middleware"
import { parseFeedbackSlug, assertFeedbackToken } from "./feedback-token.util"
import { Review, ReviewStats, ListReviewsFilters, IMPROVEMENT_TAGS, ClientReviewEntry } from "./reviews.types"

export const reviewsService = {

  async getReviews(salonId: string, filters: ListReviewsFilters): Promise<{ data: Review[]; total: number }> {
    return reviewsRepository.list(salonId, filters)
  },

  async getStats(salonId: string, staffId?: string): Promise<ReviewStats> {
    return reviewsRepository.getStats(salonId, staffId)
  },

  async listForClient(clientId: string, salonId: string): Promise<ClientReviewEntry[]> {
    return reviewsRepository.listForClient(clientId, salonId)
  },

  // ── Public feedback form (no login) — deep-linked from the review_request
  // WhatsApp button, replaces the old WA-native star-rating list flow below.

  async getPublicFeedbackContext(slug: string): Promise<{
    salonName:        string
    clientName:       string
    appointmentId:    string
    services:         Array<{ serviceRowId: string; name: string; staffName: string | null }>
    googleReviewUrl:  string | null
  }> {
    const { appointmentId, token } = parseFeedbackSlug(slug)
    assertFeedbackToken(appointmentId, token)

    const appt = await appointmentsRepository.findById(appointmentId)
    if (!appt) throw new AppError(404, "Appointment not found", "NOT_FOUND")

    const salon = await salonsRepository.findById(appt.salon_id).catch(() => null)
    const services = Array.isArray(appt.services) ? appt.services : []

    return {
      salonName:     (appt as any).salon_name ?? "our salon",
      clientName:    (appt as any).client_name ?? "there",
      appointmentId: appt.id,
      services: services
        .filter((s) => s.id)
        .map((s) => ({
          serviceRowId: s.id as string,
          name:         s.name,
          staffName:    s.staff_name ?? null,
        })),
      googleReviewUrl: salon?.google_review_url ?? null,
    }
  },

  async submitPublicFeedback(
    slug: string,
    body: {
      overallRating:       number
      serviceRatings:      Array<{ serviceRowId: string; rating: number; comment?: string }>
      improvementTags?:    string[]
      additionalComments?: string
    }
  ): Promise<{ id: string }> {
    const { appointmentId, token } = parseFeedbackSlug(slug)
    assertFeedbackToken(appointmentId, token)

    const overallRating = Number(body.overallRating)
    if (!Number.isInteger(overallRating) || overallRating < 1 || overallRating > 5) {
      throw new AppError(400, "Overall rating must be an integer between 1 and 5", "VALIDATION_ERROR")
    }

    const improvementTags = Array.isArray(body.improvementTags) ? body.improvementTags : []
    for (const tag of improvementTags) {
      if (!(IMPROVEMENT_TAGS as readonly string[]).includes(tag)) {
        throw new AppError(400, `Unknown improvement tag: ${tag}`, "VALIDATION_ERROR")
      }
    }
    const additionalComments = body.additionalComments ? String(body.additionalComments).slice(0, 1000) : null

    const appt = await appointmentsRepository.findById(appointmentId)
    if (!appt) throw new AppError(404, "Appointment not found", "NOT_FOUND")

    const services = Array.isArray(appt.services) ? appt.services : []
    const serviceById = new Map(services.filter((s) => s.id).map((s) => [s.id as string, s]))

    if (!Array.isArray(body.serviceRatings) || body.serviceRatings.length !== serviceById.size) {
      throw new AppError(400, "A rating is required for every service on this appointment", "VALIDATION_ERROR")
    }

    const serviceRatings = body.serviceRatings.map((r) => {
      const service = serviceById.get(r.serviceRowId)
      if (!service) throw new AppError(400, `Unknown service: ${r.serviceRowId}`, "VALIDATION_ERROR")

      const rating = Number(r.rating)
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new AppError(400, `Rating for "${service.name}" must be an integer between 1 and 5`, "VALIDATION_ERROR")
      }

      return {
        serviceRowId: r.serviceRowId,
        serviceId:    service.service_id ?? null,
        serviceName:  service.name,
        staffId:      service.staff_id ?? null,
        staffName:    service.staff_name ?? null,
        rating,
        comment:      r.comment ? String(r.comment).slice(0, 1000) : null,
      }
    })

    const review = await reviewsRepository.upsertRatingForAppointment({
      salonId:            appt.salon_id,
      clientId:           appt.client_id ?? null,
      phone:              (appt as any).client_phone ?? null,
      staffId:            appt.staff_id ?? null,
      appointmentId,
      overallRating,
      improvementTags,
      additionalComments,
    })

    await reviewsRepository.upsertServiceRatings(review.id, appointmentId, serviceRatings)

    return { id: review.id }
  },
}
