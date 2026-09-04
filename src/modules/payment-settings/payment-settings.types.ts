export type PaymentTerminal = {
  id: string;
  salon_id: string;
  branch_id: string | null;
  provider: string;
  terminal_label: string;
  provider_terminal_id: string | null;
  serial_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateTerminalBody = {
  salon_id: string;
  branch_id?: string | null;
  provider: string;
  terminal_label: string;
  provider_terminal_id?: string | null;
  serial_number?: string | null;
};

export type UpdateTerminalBody = Partial<Omit<CreateTerminalBody, 'salon_id'>> & { is_active?: boolean };

export type PaymentProviderConfig = {
  id: string;
  salon_id: string;
  provider: string;
  environment: 'sandbox' | 'production';
  merchant_id: string | null;
  credentials: Record<string, string> | null;
  is_enabled: boolean;
  last_tested_at: string | null;
  last_test_result: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertProviderConfigBody = {
  salon_id: string;
  provider: string;
  environment?: 'sandbox' | 'production';
  merchant_id?: string | null;
  credentials?: Record<string, string>;
  is_enabled?: boolean;
};
