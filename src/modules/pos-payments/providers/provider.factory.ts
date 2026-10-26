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
   * New payments (default) need the provider enabled and use its current
   * Live/Test mode. Follow-ups on an existing transaction (status check,
   * cancel, recovery) pass `followUp` with the mode the sale was sent in:
   * they must keep working after the provider is disabled, and must keep
   * talking to the server that actually holds the transaction even if the
   * mode was changed since — otherwise a payment in flight could never be
   * confirmed or cancelled.
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
    const mode = followUp?.environment || config.environment;
    const environment = mode === 'production' ? 'production' : 'sandbox';

    switch (provider) {
      case 'paytm':
        return new PaytmProvider(credentials, environment);
      default:
        throw new AppError(400, `Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER');
    }
  },
};
