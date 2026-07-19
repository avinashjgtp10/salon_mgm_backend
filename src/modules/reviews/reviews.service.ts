import logger from "../../config/logger"
import { reviewsRepository } from "./reviews.repository"
import { whatsappAutomationRepository } from "../whatsapp-automation/whatsapp-automation.repository"
import { configRepository } from "../marketing/whatsapp/config/config.repository"
import { whatsappMetaApi } from "../marketing/whatsapp/shared/whatsapp.api"
import { Review, ReviewStats, ListReviewsFilters } from "./reviews.types"

const RATING_ROWS = [1, 2, 3, 4, 5].map((n) => ({
  id:    `rating_${n}`,
  title: "⭐".repeat(n) + ` ${n} star${n > 1 ? "s" : ""}`,
}))

export const reviewsService = {

  async getReviews(salonId: string, filters: ListReviewsFilters): Promise<{ data: Review[]; total: number }> {
    return reviewsRepository.list(salonId, filters)
  },

  async getStats(salonId: string, staffId?: string): Promise<ReviewStats> {
    return reviewsRepository.getStats(salonId, staffId)
  },

  // Called for every plain-text inbound message — fire-and-forget from
  // webhooks.service.ts, must never throw uncaught or block the Inbox path.
  async handleTextReply(salonId: string, phone: string, _text: string): Promise<void> {
    const log = await whatsappAutomationRepository.findRecentReviewRequestLog(phone, salonId)
    if (!log) return // not a review-flow reply

    const referenceId = log.reference_id
    if (!referenceId) return

    // Atomic guard — a second reply for the same appointment loses the race,
    // the star-rating list is only ever sent once per appointment.
    const won = await whatsappAutomationRepository.guardInsertIfNotExists(`review-list-sent:${referenceId}`)
    if (!won) return

    const salonConfig = await configRepository.findBySalonId(salonId)
    if (!salonConfig?.phone_number_id || !salonConfig?.access_token) {
      logger.info(`[REVIEWS] SKIP list send — salon ${salonId} has no WhatsApp config`)
      return
    }

    const staffId = await reviewsRepository.findAppointmentStaffId(referenceId).catch(() => null)

    try {
      const result = await whatsappMetaApi.sendInteractiveListMessage({
        phoneNumberId: salonConfig.phone_number_id,
        accessToken:   salonConfig.access_token,
        to:            phone,
        bodyText:      "Thanks for getting back to us! How would you rate your visit?",
        buttonText:    "Rate visit",
        sectionTitle:  "Your rating",
        rows:          RATING_ROWS,
      })
      const listPromptWamid = result?.messages?.[0]?.id ?? null

      await reviewsRepository.createPrompt({
        salonId,
        clientId:           log.client_id,
        phone,
        appointmentId:      referenceId,
        staffId,
        reviewRequestWamid: log.meta_message_id,
        optInWamid:         null,
        listPromptWamid,
      })
      logger.info(`[REVIEWS] Star-rating list sent to ${phone} for appointment ${referenceId}`)
    } catch (err: any) {
      logger.warn(`[REVIEWS] Failed to send star-rating list to ${phone}: ${err?.message}`)
    }
  },

  // Called for inbound interactive list_reply messages.
  async handleListReply(salonId: string, msg: any): Promise<void> {
    const listReplyId = msg?.interactive?.list_reply?.id as string | undefined
    const match = listReplyId?.match(/^rating_([1-5])$/)
    if (!match) {
      logger.warn(`[REVIEWS] Unparseable list_reply id: ${listReplyId}`)
      return
    }
    const rating = parseInt(match[1], 10)

    const contextWamid = msg?.context?.id as string | undefined
    let prompt = contextWamid ? await reviewsRepository.findPromptByListWamid(contextWamid) : null
    if (!prompt) prompt = await reviewsRepository.findMostRecentPendingPrompt(salonId, msg.from)
    if (!prompt) {
      logger.warn(`[REVIEWS] No pending prompt found for rating reply from ${msg.from}`)
      return
    }

    const updated = await reviewsRepository.markRated(prompt.id, rating)
    if (!updated) return // already rated — double-tap or redelivered webhook, skip

    const review = await reviewsRepository.insertRating({
      salonId:     updated.salon_id,
      clientId:    updated.client_id,
      phone:       updated.phone,
      staffId:     updated.staff_id,
      rating,
      waMessageId: msg.id,
    })
    await reviewsRepository.setReviewId(updated.id, review.id)
    logger.info(`[REVIEWS] Captured ${rating}-star rating from ${msg.from} (review ${review.id})`)
  },
}
