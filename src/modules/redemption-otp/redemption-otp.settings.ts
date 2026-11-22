import { settingsRepository } from "../settings/settings.repository";

// Per-salon switches for "client must confirm a WhatsApp OTP before a Package
// session / Membership benefit is redeemed" - one for packages, one for
// memberships, independent of each other. Same salon_settings convention as
// package-settings.util.ts: one reserved key, JSON value, default when absent.
// Default is OFF for both - a salon turns them on from Settings > Extras.
//
// MUST match REDEEM_OTP_SETTING_KEY in the frontend
// (features/settings/utils/redeemOtpSetting.ts).
export const REDEEM_OTP_SETTING_KEY = "redeem_otp_required";

export type RedeemKind = "package" | "membership" | "rewardPoints";
export type RedeemOtpConfig = Record<RedeemKind, boolean>;

const OFF: RedeemOtpConfig = { package: false, membership: false, rewardPoints: false };

export async function getRedemptionOtpConfig(salonId: string): Promise<RedeemOtpConfig> {
  const rows = await settingsRepository.findAll(salonId);
  const row = rows.find((r) => r.key === REDEEM_OTP_SETTING_KEY);
  if (!row?.value) return OFF;
  try {
    const v = JSON.parse(row.value);
    // Legacy single switch ({ enabled: true }, saved before there were two) turned on both.
    if (v?.package === undefined && v?.membership === undefined) {
      return v?.enabled === true ? { package: true, membership: true, rewardPoints: true } : OFF;
    }
    // Reward points have their own switch; off unless saved as on.
    return { package: v.package === true, membership: v.membership === true, rewardPoints: v.rewardPoints === true };
  } catch {
    return OFF;
  }
}

// Is the OTP rule on for at least one of the two? (Used to decide whether the OTP endpoints are usable.)
export async function isRedemptionOtpRequired(salonId: string): Promise<boolean> {
  const c = await getRedemptionOtpConfig(salonId);
  return c.package || c.membership || c.rewardPoints;
}
