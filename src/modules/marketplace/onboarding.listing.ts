import { onboardingRepository, isMissingMigration } from "./onboarding.repository";
import type { ServiceSetting } from "./onboarding.rules";

// What the public Marketplace is allowed to show for one salon. Used by the booking module whenever a request
// says it comes from the Marketplace.

export interface MarketplaceListing {
    bookingsEnabled: boolean;
    hiddenStaff: Set<string>;
    serviceSettings: Map<string, ServiceSetting>;
}

/** null unless the salon has been approved (also null while the migration has not been run). */
export async function getApprovedListing(salonId: string): Promise<MarketplaceListing | null> {
    try {
        const row = await onboardingRepository.find(salonId);
        if (row?.status !== "approved") return null;
        return {
            bookingsEnabled: row.bookings_enabled,
            hiddenStaff: new Set(row.hidden_staff_ids ?? []),
            serviceSettings: await onboardingRepository.serviceSettings(salonId),
        };
    } catch (err) {
        if (isMissingMigration(err)) return null;
        throw err;
    }
}
