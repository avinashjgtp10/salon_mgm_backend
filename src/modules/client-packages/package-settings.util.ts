import { settingsRepository } from "../settings/settings.repository";

// Same generic salon_settings key/value convention as tax.util.ts's
// getTaxModuleConfig — one reserved key, JSON-encoded value, default applied
// when the key has never been written for this salon.

const NO_SHOW_POLICY_KEY = "package_no_show_policy";

export type PackageNoShowPolicy = "do_not_deduct" | "deduct_package";

export async function getPackageNoShowPolicy(salonId: string): Promise<PackageNoShowPolicy> {
  const rows = await settingsRepository.findAll(salonId);
  const row = rows.find((r) => r.key === NO_SHOW_POLICY_KEY);
  if (!row?.value) return "do_not_deduct";
  try {
    const parsed = JSON.parse(row.value);
    return parsed?.policy === "deduct_package" ? "deduct_package" : "do_not_deduct";
  } catch {
    return "do_not_deduct";
  }
}
