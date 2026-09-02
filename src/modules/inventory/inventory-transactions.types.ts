// Generic inventory movement engine — Consumable Management is its first
// caller (see inventory-transactions.repository.ts / inventory.service.ts's
// appointmentConsumablesService), but the shape is deliberately reason-
// agnostic so Retail/Waste/Adjustment call sites can move onto it later
// without a redesign. Retail's existing productsRepository.deductStock/
// restoreStock is NOT migrated onto this yet (deliberately out of scope).

// retail_sale and waste were defined but never wired to any code path —
// retail product sales deduct products.amount directly in
// appointments.service.ts without going through this ledger at all (see
// products.repository.ts deductStock/restoreStock), and nothing ever wrote a
// "waste" reason. Only these two are ever actually used.
export type InventoryTransactionReason = "consumable_usage" | "adjustment";

export type InventoryTransactionReferenceType = "appointment_complete" | "appointment_adjustment" | "manual";

export type InventoryTransactionItem = {
  product_id: string;
  qty: number;
  unit?: string;
  // Only meaningful when reason === 'consumable_usage' — ties the ledger row
  // back to the specific appointment service-row it was deducted/returned
  // for, so two rows using the same product stay separately auditable.
  service_row_id?: string;
  service_id?: string;
};

export type InventoryShortfall = {
  product_id: string;
  product_name: string;
  available: number;
  required: number;
  short_by: number;
};

// A row of declared per-appointment consumable usage — structurally
// compatible with an `appointment_service_consumables` table row, but kept
// narrow here so this module doesn't need to import appointments' types.
export type AppointmentServiceConsumableRow = {
  service_row_id: string;
  service_id?: string | null;
  product_id: string;
  standard_qty: number;
  actual_qty: number;
  unit?: string | null;
};

export type InventoryTransactionParams = {
  reason: InventoryTransactionReason;
  items: InventoryTransactionItem[];
  salonId: string;
  branchId: string;
  referenceType: InventoryTransactionReferenceType;
  referenceId?: string;
  userId: string;
  // Default false: deduct() hard-blocks (throws INSUFFICIENT_STOCK) rather
  // than silently flooring at zero. Retail's existing behavior floors at
  // zero — a future retail migration onto this engine would pass true here
  // to preserve that, not because floor-at-zero is the right default.
  allowNegative?: boolean;
};
