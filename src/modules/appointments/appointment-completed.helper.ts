// ============================================================
// SalonOx — Appointment Completed Notification Helper
// ============================================================
// Fires Thank You + Review Request once an appointment is marked paid.
// Called from the only 2 places that mark an appointment "paid"
// (appointments.service.ts checkout() and sales.service.ts checkout()) — kept
// in its own file (not appointments.service.ts) so both call sites can import
// it without creating a circular dependency between the two service modules.

import logger from "../../config/logger";
import { appointmentsRepository } from "./appointments.repository";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import { whatsappAutomationRepository } from "../whatsapp-automation/whatsapp-automation.repository";

export async function notifyAppointmentCompleted(appointmentId: string): Promise<void> {
    try {
        const alreadyNotified = await whatsappAutomationRepository.logExistsForReference(appointmentId, "thank_you");
        if (alreadyNotified) return;

        const appt = await appointmentsRepository.findById(appointmentId);
        if (!appt) return;

        const phone = (appt as any).client_phone;
        if (!phone) return;

        const variables = {
            "1": (appt as any).client_name ?? "Valued Customer",
            "2": (appt as any).salon_name  ?? "our salon",
        };

        whatsappAutomationService.trigger({
            salonId:       appt.salon_id,
            eventType:     "thank_you",
            clientId:      appt.client_id ?? undefined,
            phone,
            countryCode:   (appt as any).client_phone_code ?? null,
            variables,
            referenceId:   appointmentId,
            referenceType: "appointment",
        }).catch(() => {});

        whatsappAutomationService.trigger({
            salonId:       appt.salon_id,
            eventType:     "review_request",
            clientId:      appt.client_id ?? undefined,
            phone,
            countryCode:   (appt as any).client_phone_code ?? null,
            variables,
            referenceId:   appointmentId,
            referenceType: "appointment",
        }).catch(() => {});
    } catch (err: any) {
        logger.error("[WA-AUTO] notifyAppointmentCompleted error:", err?.message);
    }
}
