import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "../salons/salons.repository";
import { salonsService } from "../salons/salons.service";
import { digitalMenuRepository } from "./digital-menu.repository";
import {
  DigitalMenuWithCounts,
  PublicMenuResponse,
  SaveDigitalMenuBody,
} from "./digital-menu.types";

async function enrich(menu: Awaited<ReturnType<typeof digitalMenuRepository.findBySalonId>>, salonId: string): Promise<DigitalMenuWithCounts> {
  if (!menu) throw new AppError(404, "Digital menu not found", "NOT_FOUND");
  const [selectedServiceIds, counts] = await Promise.all([
    digitalMenuRepository.findSelectedServiceIds(menu.id),
    digitalMenuRepository.countForMenu(salonId, menu.service_selection_mode, menu.id),
  ]);
  return { ...menu, selected_service_ids: selectedServiceIds, ...counts };
}

export const digitalMenuService = {
  async get(salonId: string): Promise<DigitalMenuWithCounts> {
    const menu = await digitalMenuRepository.findBySalonId(salonId);
    if (!menu) throw new AppError(404, "Digital menu not configured", "NOT_FOUND");
    return enrich(menu, salonId);
  },

  async create(salonId: string, body: SaveDigitalMenuBody): Promise<DigitalMenuWithCounts> {
    const existing = await digitalMenuRepository.findBySalonId(salonId);
    if (existing) throw new AppError(409, "Digital menu already exists for this salon", "ALREADY_EXISTS");

    const name = String(body.name || "").trim();
    if (!name) throw new AppError(400, "name is required", "VALIDATION_ERROR");

    const menu = await digitalMenuRepository.create({
      salonId,
      name,
      status: body.status ?? "active",
      serviceSelectionMode: body.service_selection_mode ?? "all_active",
    });

    if (menu.service_selection_mode === "specific" && body.selected_service_ids?.length) {
      await digitalMenuRepository.replaceSelectedServices(menu.id, body.selected_service_ids);
    }

    return enrich(menu, salonId);
  },

  async update(salonId: string, id: string, body: SaveDigitalMenuBody): Promise<DigitalMenuWithCounts> {
    const existing = await digitalMenuRepository.findById(id, salonId);
    if (!existing) throw new AppError(404, "Digital menu not found", "NOT_FOUND");

    const name = String(body.name || "").trim();
    if (!name) throw new AppError(400, "name is required", "VALIDATION_ERROR");

    const updated = await digitalMenuRepository.update({
      id,
      salonId,
      name,
      status: body.status ?? existing.status,
      serviceSelectionMode: body.service_selection_mode ?? existing.service_selection_mode,
    });
    if (!updated) throw new AppError(404, "Digital menu not found", "NOT_FOUND");

    if (updated.service_selection_mode === "specific") {
      await digitalMenuRepository.replaceSelectedServices(id, body.selected_service_ids ?? []);
    } else {
      // Switching back to "all active" clears any stale specific selection so
      // a later switch back to "specific" doesn't resurrect a stale list.
      await digitalMenuRepository.replaceSelectedServices(id, []);
    }

    return enrich(updated, salonId);
  },

  async getPublicByToken(token: string): Promise<PublicMenuResponse> {
    const menu = await digitalMenuRepository.findByPublicToken(token);
    if (!menu) throw new AppError(404, "Menu not found", "NOT_FOUND");

    const salon = await salonsRepository.findById(menu.salon_id);
    if (!salon) throw new AppError(404, "Menu not found", "NOT_FOUND");

    // Inactive menus still resolve (so the frontend can show "unavailable"),
    // but never leak service/pricing data to a customer who hits an off menu.
    if (menu.status !== "active") {
      return {
        status: "inactive",
        name: menu.name,
        salon: { name: salon.business_name, logo_url: null, cover_image_url: null, phone: null, address: null },
        currency: null,
        categories: [],
        booking_slug: null,
      };
    }

    const rows = await digitalMenuRepository.findPublicServices(menu.salon_id, menu.service_selection_mode, menu.id);

    const byCategory = new Map<string, PublicMenuResponse["categories"][number]>();
    for (const r of rows) {
      const key = r.category_name as string;
      if (!byCategory.has(key)) byCategory.set(key, { name: key, services: [] });
      byCategory.get(key)!.services.push({
        id: r.id,
        name: r.name,
        description: r.description,
        price: r.price,
        price_type: r.price_type,
        duration: r.duration,
        online_booking: r.online_booking,
      });
    }

    const salonWithSlug = await salonsService.ensureSlug(salon);

    return {
      status: "active",
      name: menu.name,
      salon: {
        name: salon.business_name,
        logo_url: salon.logo_url,
        cover_image_url: salon.banner_url,
        phone: salon.phone,
        address: salon.address,
      },
      currency: salon.currency,
      categories: Array.from(byCategory.values()),
      booking_slug: salonWithSlug.slug,
    };
  },
};
