import { clientPackagesRepository } from "./client-packages.repository";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import logger from "../../config/logger";
import type {
  ClientPackage,
  CreateClientPackageDTO,
  CompleteSessionDTO,
  ClientPackagesListQuery,
} from "./client-packages.types";

export const clientPackagesService = {

  async list(
    salonId: string,
    query: ClientPackagesListQuery,
  ): Promise<{ items: ClientPackage[]; total: number }> {
    return clientPackagesRepository.list(salonId, query);
  },

  async getById(id: string, salonId: string): Promise<ClientPackage> {
    const pkg = await clientPackagesRepository.findById(id, salonId);
    if (!pkg) throw { statusCode: 404, message: "Client package not found" };
    return pkg;
  },

  async create(salonId: string, dto: CreateClientPackageDTO): Promise<ClientPackage> {
    const pkg = await clientPackagesRepository.create(salonId, dto);

    // ── WhatsApp Automation: Membership / Package Purchased ───────────────────
    // mobile field on ClientPackage is the client's phone number
    if (pkg.mobile) {
      whatsappAutomationService.trigger({
        salonId:       pkg.salonId,
        eventType:     "membership_purchased",
        clientId:      pkg.clientId,
        phone:         pkg.mobile,
        countryCode:   null,   // client-packages doesn't store country code separately
        variables: {
          "1": pkg.clientName  ?? "Valued Customer",
          "2": pkg.packageName,
          "3": pkg.expiryDate
               ? new Date(pkg.expiryDate).toLocaleDateString("en-IN", {
                   timeZone: "Asia/Kolkata",
                   day: "2-digit", month: "short", year: "numeric",
                 })
               : "N/A",
        },
        referenceId:   pkg.id,
        referenceType: "membership",
      }).catch(() => {});
    } else {
      logger.info(`[WA-AUTO] Skipping membership_purchased for package ${pkg.id} — no mobile number`)
    }

    return pkg;
  },

  async completeSession(
    packageId: string,
    salonId:   string,
    dto:       CompleteSessionDTO,
  ): Promise<ClientPackage> {
    const updated = await clientPackagesRepository.completeSession(packageId, salonId, dto);
    if (!updated) throw { statusCode: 404, message: "Client package not found" };
    return updated;
  },

  async update(id: string, salonId: string, dto: any): Promise<ClientPackage | null> {
    const updated = await clientPackagesRepository.update(id, salonId, dto);
    if (!updated) throw { statusCode: 404, message: "Client package not found" };
    return updated;
  },

  async delete(id: string, salonId: string): Promise<boolean> {
    const deleted = await clientPackagesRepository.delete(id, salonId);
    if (!deleted) throw { statusCode: 404, message: "Client package not found" };
    return deleted;
  },
};
