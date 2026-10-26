import { AppError } from '../../middleware/error.middleware';
import { paymentSettingsRepository } from './payment-settings.repository';
import { posPaymentsRepository } from '../pos-payments/pos-payments.repository';
import { ManualProvider } from '../pos-payments/providers/manual.provider';
import { PaytmProvider } from '../pos-payments/providers/paytm.provider';
import {
  CreateTerminalBody, UpdateTerminalBody, UpsertProviderConfigBody,
} from './payment-settings.types';

const KNOWN_PROVIDERS = ['manual', 'paytm'];
const ENVIRONMENTS = ['sandbox', 'production'];
// Paytm TIDs are short alphanumeric ids printed on the machine (Sale API: up to 8; Status API: up to 16).
const PAYTM_TID = /^[A-Za-z0-9]{1,16}$/;

/** Rejects a terminal Paytm couldn't route a sale to. */
function assertValidTid(provider: string | undefined, tid: string | null | undefined): void {
  if (provider !== 'paytm') return;
  const value = String(tid ?? '').trim();
  if (!value) throw new AppError(400, 'TID is required for a Paytm terminal — it is on the machine\'s info screen, next to MID', 'VALIDATION_ERROR');
  if (!PAYTM_TID.test(value)) throw new AppError(400, 'TID must be letters and digits only, exactly as printed on the machine', 'VALIDATION_ERROR');
}

/**
 * Trimmed credential values, dropping blanks and the redacted placeholder
 * listProviderConfigs sends back ('••••••••'). Undefined when nothing is left.
 */
function cleanCredentials(credentials?: Record<string, string> | null): Record<string, string> | undefined {
  if (!credentials || typeof credentials !== 'object') return undefined;
  const entries = Object.entries(credentials)
    .map(([key, value]) => [key, String(value ?? '').trim()] as const)
    .filter(([, value]) => value !== '' && !/^•+$/.test(value));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export const paymentSettingsService = {

  listTerminals: (salonId: string) => paymentSettingsRepository.listTerminals(salonId),

  async createTerminal(data: CreateTerminalBody) {
    if (!data.terminal_label?.trim()) throw new AppError(400, 'terminal_label is required', 'VALIDATION_ERROR');
    if (!data.provider) throw new AppError(400, 'provider is required', 'VALIDATION_ERROR');
    assertValidTid(data.provider, data.provider_terminal_id);
    return paymentSettingsRepository.createTerminal({ ...data, provider_terminal_id: data.provider_terminal_id?.trim() || null });
  },

  /**
   * Editing a terminal (even its TID) is safe mid-payment: an in-flight
   * payment keeps using the TID snapshotted on it when it was sent.
   */
  async updateTerminal(id: string, salonId: string, data: UpdateTerminalBody) {
    const current = await paymentSettingsRepository.findTerminalById(id, salonId);
    if (!current) throw new AppError(404, 'Terminal not found', 'NOT_FOUND');
    if (data.provider_terminal_id !== undefined) assertValidTid(data.provider ?? current.provider, data.provider_terminal_id);
    const patch = data.provider_terminal_id !== undefined ? { ...data, provider_terminal_id: data.provider_terminal_id?.trim() || null } : data;
    const updated = await paymentSettingsRepository.updateTerminal(id, salonId, patch);
    if (!updated) throw new AppError(404, 'Terminal not found', 'NOT_FOUND');
    return updated;
  },

  async deleteTerminal(id: string, salonId: string) {
    const current = await paymentSettingsRepository.findTerminalById(id, salonId);
    if (!current) throw new AppError(404, 'Terminal not found', 'NOT_FOUND');
    // Payment history points at the terminal (and an in-flight payment may
    // still need it) — keep the row, just stop offering it.
    if (await posPaymentsRepository.hasRequestsForTerminal(id)) {
      throw new AppError(409, 'This machine has payment history, so it can\'t be deleted — set it to Inactive instead.', 'TERMINAL_IN_USE');
    }
    const ok = await paymentSettingsRepository.deleteTerminal(id, salonId);
    if (!ok) throw new AppError(404, 'Terminal not found', 'NOT_FOUND');
  },

  listProviderConfigs: (salonId: string) => paymentSettingsRepository.listProviderConfigs(salonId),

  async upsertProviderConfig(data: UpsertProviderConfigBody) {
    if (!data.provider) throw new AppError(400, 'provider is required', 'VALIDATION_ERROR');
    if (!KNOWN_PROVIDERS.includes(data.provider)) {
      throw new AppError(400, `Unknown provider: ${data.provider}`, 'UNKNOWN_PROVIDER');
    }
    if (data.environment !== undefined && !ENVIRONMENTS.includes(data.environment)) {
      throw new AppError(400, 'environment must be "sandbox" or "production"', 'VALIDATION_ERROR');
    }

    // The settings form starts with empty fields (stored secrets are never
    // sent back), so a blank field means "keep what's saved", never "erase
    // it" — Save changes / Disable must not wipe the MID or Merchant Key.
    const existing = await paymentSettingsRepository.findProviderConfig(data.salon_id, data.provider);
    const incoming = cleanCredentials(data.credentials);
    const credentials = incoming ? { ...(existing?.credentials ?? {}), ...incoming } : undefined;

    // A payment in flight is confirmed/cancelled with these exact credentials
    // on the server it was sent to — changing either mid-payment would leave
    // it unconfirmable. Turning the provider off is still allowed (it only
    // stops new payments; in-flight ones keep being checked).
    const credentialsChange = !!credentials && !!existing?.credentials
      && Object.keys(credentials).some((key) => credentials[key] !== existing.credentials?.[key]);
    const environmentChange = !!existing && data.environment !== undefined && data.environment !== existing.environment;
    if (credentialsChange || environmentChange) {
      const unsettled = await posPaymentsRepository.countUnsettledForProvider(data.salon_id, data.provider);
      if (unsettled > 0) {
        throw new AppError(
          409,
          `${unsettled} payment-machine payment${unsettled === 1 ? ' is' : 's are'} still in progress or being saved. ` +
            'Finish or cancel them before changing the MID, Merchant Key or Mode.',
          'POS_PAYMENTS_IN_PROGRESS',
          { unsettled },
        );
      }
    }

    // Reject a config that can't take a payment now, at save time, instead
    // of every checkout failing later with the same error.
    const willBeEnabled = data.is_enabled ?? existing?.is_enabled ?? false;
    if (willBeEnabled && data.provider === 'paytm') {
      const effective = credentials ?? existing?.credentials ?? {};
      if (!String(effective.mid ?? '').trim() || !String(effective.merchantKey ?? '').trim()) {
        throw new AppError(400, 'Enter both the Merchant ID (MID) and Merchant Key to enable Paytm', 'VALIDATION_ERROR');
      }
      try {
        new PaytmProvider(effective, (data.environment ?? existing?.environment) === 'production' ? 'production' : 'sandbox');
      } catch (err: any) {
        throw new AppError(400, err?.message ?? 'Invalid Paytm credentials', 'VALIDATION_ERROR');
      }
    }

    const saved = await paymentSettingsRepository.upsertProviderConfig({ ...data, credentials });
    if (saved.is_enabled) await paymentSettingsRepository.disableOtherProviders(data.salon_id, data.provider);
    return saved;
  },

  async testConnection(salonId: string, provider: string): Promise<{ ok: boolean; message: string }> {
    if (provider === 'manual') {
      const result = await new ManualProvider().testConnection();
      await paymentSettingsRepository.recordTestResult(salonId, provider, result.ok, result.message);
      return result;
    }

    const config = await paymentSettingsRepository.findProviderConfig(salonId, provider);
    if (!config) throw new AppError(404, 'Provider is not configured for this salon yet — save credentials first', 'NOT_FOUND');

    let result: { ok: boolean; message: string };
    switch (provider) {
      case 'paytm': {
        let paytm: PaytmProvider;
        try {
          paytm = new PaytmProvider(config.credentials ?? {}, config.environment === 'production' ? 'production' : 'sandbox');
        } catch (err: any) {
          // Bad saved credentials (missing MID/Key, wrong key length) — report, don't 500.
          result = { ok: false, message: err?.message ?? 'Invalid Paytm credentials' };
          break;
        }
        const terminals = await paymentSettingsRepository.listTerminals(salonId);
        const tids = terminals
          .filter((t) => t.provider === 'paytm' && t.is_active && t.provider_terminal_id?.trim())
          .map((t) => t.provider_terminal_id!.trim());
        result = await paytm.testConnection({ terminalProviderIds: tids });
        break;
      }
      default:
        throw new AppError(400, `Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER');
    }

    await paymentSettingsRepository.recordTestResult(salonId, provider, result.ok, result.message);
    return result;
  },
};
