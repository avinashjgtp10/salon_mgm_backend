import { AppError } from '../../../middleware/error.middleware';
import { paymentSettingsRepository } from '../../payment-settings/payment-settings.repository';
import { PosProviderId } from '../pos-payments.types';
import { PaymentProvider } from './provider.types';
import { ManualProvider } from './manual.provider';
import { PaytmProvider } from './paytm.provider';

export const providerFactory = {
  async getProvider(salonId: string, provider: PosProviderId): Promise<PaymentProvider> {
    if (provider === 'manual') return new ManualProvider();

    const config = await paymentSettingsRepository.findProviderConfig(salonId, provider);
    if (!config || !config.is_enabled) {
      throw new AppError(400, `${provider} is not configured/enabled for this salon`, 'PROVIDER_NOT_CONFIGURED');
    }
    const credentials = (config.credentials ?? {}) as Record<string, string>;
    const environment = config.environment === 'production' ? 'production' : 'sandbox';

    switch (provider) {
      case 'paytm':
        return new PaytmProvider(credentials, environment);
      default:
        throw new AppError(400, `Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER');
    }
  },
};
