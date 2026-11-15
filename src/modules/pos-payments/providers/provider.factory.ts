import { AppError } from '../../../middleware/error.middleware';
import { paymentSettingsRepository } from '../../payment-settings/payment-settings.repository';
import { PosProviderId } from '../pos-payments.types';
import { PaymentProvider } from './provider.types';
import { ManualProvider } from './manual.provider';
import { PaytmProvider } from './paytm.provider';

export const providerFactory = {
  /**
   * A provider client for the salon.
   *
   * New payments need the provider enabled. Paytm always uses staging.
   * Follow-ups keep working after disabling the provider, but historical
   * production transactions are rejected rather than queried on staging.
   */
  async getProvider(
    salonId: string,
    provider: PosProviderId,
    followUp?: { environment?: string | null },
  ): Promise<PaymentProvider> {
    if (provider === 'manual') return new ManualProvider();

    const config = await paymentSettingsRepository.findProviderConfig(salonId, provider);
    if (!config || (!followUp && !config.is_enabled)) {
      throw new AppError(400, `${provider} is not configured/enabled for this salon`, 'PROVIDER_NOT_CONFIGURED');
    }
    const credentials = (config.credentials ?? {}) as Record<string, string>;
    // Never query staging for a transaction originally created in production.
    if (provider === 'paytm' && followUp?.environment === 'production') {
      throw new AppError(409, 'Paytm production transactions cannot be accessed by this staging-only integration.', 'PAYTM_STAGING_ONLY');
    }

    switch (provider) {
      case 'paytm':
        return new PaytmProvider(credentials);
      default:
        throw new AppError(400, `Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER');
    }
  },
};
