import { AppError } from '../../middleware/error.middleware';
import { paymentSettingsRepository } from './payment-settings.repository';
import { ManualProvider } from '../pos-payments/providers/manual.provider';
import { PaytmProvider } from '../pos-payments/providers/paytm.provider';
import {
  CreateTerminalBody, UpdateTerminalBody, UpsertProviderConfigBody,
} from './payment-settings.types';

export const paymentSettingsService = {

  listTerminals: (salonId: string) => paymentSettingsRepository.listTerminals(salonId),

  async createTerminal(data: CreateTerminalBody) {
    if (!data.terminal_label?.trim()) throw new AppError(400, 'terminal_label is required', 'VALIDATION_ERROR');
    if (!data.provider) throw new AppError(400, 'provider is required', 'VALIDATION_ERROR');
    return paymentSettingsRepository.createTerminal(data);
  },

  async updateTerminal(id: string, salonId: string, data: UpdateTerminalBody) {
    const updated = await paymentSettingsRepository.updateTerminal(id, salonId, data);
    if (!updated) throw new AppError(404, 'Terminal not found', 'NOT_FOUND');
    return updated;
  },

  async deleteTerminal(id: string, salonId: string) {
    const ok = await paymentSettingsRepository.deleteTerminal(id, salonId);
    if (!ok) throw new AppError(404, 'Terminal not found', 'NOT_FOUND');
  },

  listProviderConfigs: (salonId: string) => paymentSettingsRepository.listProviderConfigs(salonId),

  async upsertProviderConfig(data: UpsertProviderConfigBody) {
    if (!data.provider) throw new AppError(400, 'provider is required', 'VALIDATION_ERROR');
    return paymentSettingsRepository.upsertProviderConfig(data);
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
      case 'paytm':
        result = await new PaytmProvider(
          config.credentials ?? {},
          config.environment === 'production' ? 'production' : 'sandbox',
        ).testConnection();
        break;
      default:
        throw new AppError(400, `Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER');
    }

    await paymentSettingsRepository.recordTestResult(salonId, provider, result.ok, result.message);
    return result;
  },
};
