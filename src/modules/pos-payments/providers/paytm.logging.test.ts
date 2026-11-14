import axios from 'axios';
import logger from '../../../config/logger';
import { PaytmProvider } from './paytm.provider';

jest.mock('axios');
jest.mock('../../../config/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const MERCHANT_KEY = '1234567890123456';
const credentials = { mid: 'TESTMID', merchantKey: MERCHANT_KEY };
const ctx = {
  reference: 'PAY12345678',
  providerTransactionId: null,
  terminalProviderId: '12345678',
  requestedAt: new Date('2026-11-12T06:00:00Z'),
};

const provider = () => new PaytmProvider(credentials);
/** Every field of every log line this test produced, as one searchable string. */
const allLogText = () =>
  JSON.stringify(
    [...(logger.info as jest.Mock).mock.calls, ...(logger.warn as jest.Mock).mock.calls, ...(logger.error as jest.Mock).mock.calls],
  );

beforeEach(() => {
  jest.clearAllMocks();
  (axios.post as jest.Mock).mockResolvedValue({
    status: 200,
    data: { head: { checksum: 'RESPONSE-CHECKSUM' }, body: { resultInfo: { resultCodeId: '0009', resultCode: 'A', resultStatus: 'A', resultMsg: 'Accepted' } } },
  });
});

it('logs one line per ECR call with both sides of the exchange', async () => {
  await provider().createPayment({ ...ctx, amount: 100, currency: 'INR' });

  expect(logger.info).toHaveBeenCalledTimes(1);
  const [message, meta] = (logger.info as jest.Mock).mock.calls[0];
  expect(message).toContain('ECR call');
  expect(meta).toMatchObject({
    api: 'SALE',
    traceId: 'PAY12345678',
    merchantTransactionId: 'PAY12345678',
    mid: 'TESTMID',
    tid: '12345678',
    httpStatus: 200,
    resultCodeId: '0009',
    resultStatus: 'A',
  });
  // Both directions, the amount actually sent, and a latency, are all present.
  expect((meta.request as any).transactionAmount).toBe('10000');
  expect(meta.response).toBeDefined();
  expect(typeof meta.latencyMs).toBe('number');
});

it('uses the same trace id across the sale, every status poll and the abort', async () => {
  const p = provider();
  await p.createPayment({ ...ctx, amount: 100, currency: 'INR' });
  await p.getPaymentStatus(ctx);
  await p.getPaymentStatus(ctx);
  await p.cancelPayment(ctx);

  const lines = (logger.info as jest.Mock).mock.calls.map(([, meta]) => meta);
  expect(lines.map((l) => l.api)).toEqual(['SALE', 'STATUS', 'STATUS', 'ABORT']);
  expect(new Set(lines.map((l) => l.traceId))).toEqual(new Set(['PAY12345678']));
});

it('logs a failed call with its HTTP status and Paytm result code, then rethrows', async () => {
  (axios.post as jest.Mock).mockRejectedValue({
    code: 'ECONNABORTED',
    message: 'timeout of 15000ms exceeded',
    response: { status: 502, data: { body: { resultInfo: { resultCodeId: '0012', resultMsg: 'Internal error' } } } },
    config: { data: `{"head":{"checksum":"SIGNED-CHECKSUM"}}` },
  });

  await provider().cancelPayment(ctx);

  expect(logger.warn).toHaveBeenCalled();
  const failure = (logger.warn as jest.Mock).mock.calls.find(([m]) => String(m).includes('ECR call failed'));
  expect(failure).toBeDefined();
  expect(failure![1]).toMatchObject({ api: 'ABORT', httpStatus: 502, resultCodeId: '0012', code: 'ECONNABORTED' });
});

it('never logs the merchant key or any checksum', async () => {
  const p = provider();
  await p.createPayment({ ...ctx, amount: 100, currency: 'INR' });
  await p.getPaymentStatus(ctx);

  const logged = allLogText();
  expect(logged).not.toContain(MERCHANT_KEY);
  expect(logged.toLowerCase()).not.toContain('checksum');
  expect(logged).not.toContain('RESPONSE-CHECKSUM');
});
