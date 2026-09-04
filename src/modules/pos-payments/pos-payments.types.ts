import { CreatePaymentBody } from '../payments/payments.types';

export type PosPaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED';

// Statuses a request can still transition out of. Any webhook/poll/cancel
// landing on a request NOT in this set is a no-op — see the atomic
// conditional UPDATE in pos-payments.repository.ts's transitionStatus().
export const NON_TERMINAL_STATUSES: PosPaymentStatus[] = ['PENDING', 'PROCESSING'];

export type PosProviderId = 'manual' | 'paytm';

export type PosPaymentRequest = {
  id: string;
  salon_id: string;
  branch_id: string | null;
  appointment_id: string | null;
  client_id: string | null;
  sale_id: string | null;
  payment_id: string | null;
  terminal_id: string | null;
  payment_reference: string;
  provider: PosProviderId;
  provider_transaction_id: string | null;
  amount: number;
  currency: string;
  status: PosPaymentStatus;
  origin_flow: string;
  payload: CreatePaymentBody;
  provider_response: unknown | null;
  needs_review: boolean;
  review_reason: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
};

export type CreatePosPaymentBody = {
  salon_id: string;
  branch_id?: string;
  appointment_id: string;
  client_id?: string;
  terminal_id?: string | null;
  amount: number;
  currency?: string;
  // The exact CreatePaymentBody the frontend already built for this bill —
  // stored verbatim and replayed into payments.service.ts's create() once
  // the provider confirms SUCCESS.
  payload: CreatePaymentBody;
  created_by: string;
};

export type PosPaymentEvent = {
  id: string;
  pos_payment_request_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  raw_payload: unknown | null;
  created_at: string;
};
