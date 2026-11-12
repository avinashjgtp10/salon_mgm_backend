import axios from 'axios';
import { PaytmProvider } from './paytm.provider';
import { providerFactory } from './provider.factory';
import { paymentSettingsRepository } from '../../payment-settings/payment-settings.repository';

jest.mock('axios');
jest.mock('../../../config/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../../payment-settings/payment-settings.repository', () => ({
  paymentSettingsRepository: { findProviderConfig: jest.fn() },
}));

const credentials = { mid: 'TESTMID', merchantKey: '1234567890123456' };
const ctx = {
  reference: 'PAY12345678', providerTransactionId: null,
  terminalProviderId: '12345678', requestedAt: new Date('2026-11-12T06:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  (axios.post as jest.Mock).mockResolvedValue({ data: { body: { resultInfo: { resultCode: '0404' } } } });
  (paymentSettingsRepository.findProviderConfig as jest.Mock).mockResolvedValue({
    credentials, environment: 'production', is_enabled: true,
  });
});

it('uses staging for sale, status, abort and connection probes even with an old production config', async () => {
  const provider = await providerFactory.getProvider('salon', 'paytm');
  await provider.createPayment({ ...ctx, amount: 1, currency: 'INR' });
  await provider.getPaymentStatus(ctx);
  await provider.cancelPayment(ctx);
  await provider.testConnection({ terminalProviderIds: [ctx.terminalProviderId] });
  expect((axios.post as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
    'https://securegw-stage.paytmpayments.in/ecr/payment/request',
    'https://securegw-stage.paytmpayments.in/ecr/V2/payment/status',
    'https://securegw-stage.paytm.in/ecr/abort/txn',
    'https://securegw-stage.paytmpayments.in/ecr/V2/payment/status',
  ]);
  for (const [, , options] of (axios.post as jest.Mock).mock.calls) {
    expect(options.maxRedirects).toBe(0);
  }
});

it('blocks historical production follow-ups before any HTTP request', async () => {
  await expect(providerFactory.getProvider('salon', 'paytm', { environment: 'production' }))
    .rejects.toMatchObject({ code: 'PAYTM_STAGING_ONLY' });
  expect(axios.post).not.toHaveBeenCalled();
});

it('labels connection diagnostics as sandbox', async () => {
  const result = await new PaytmProvider(credentials).testConnection({ terminalProviderIds: ['12345678'] });
  expect(result.message).toContain('Test (sandbox)');
});
