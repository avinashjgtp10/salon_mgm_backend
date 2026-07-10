import { settingsRepository } from "../settings/settings.repository";
import { ReferralConfig, DEFAULT_REFERRAL_CONFIG } from "./referral.types";

const CONFIG_KEY = "REFERRAL_CONFIG";

export const referralRepository = {
  async getConfig(salonId: string): Promise<ReferralConfig> {
    const settings = await settingsRepository.findAll(salonId);
    const row = settings.find((s) => s.key === CONFIG_KEY);
    if (!row?.value) return DEFAULT_REFERRAL_CONFIG;
    try {
      const parsed = JSON.parse(row.value);
      return { ...DEFAULT_REFERRAL_CONFIG, ...parsed };
    } catch {
      return DEFAULT_REFERRAL_CONFIG;
    }
  },
};
