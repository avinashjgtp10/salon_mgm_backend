export type ConsumableStockStatus = "healthy" | "low_stock" | "out_of_stock";

const roundStock = (value: number) => Number(value.toFixed(3));

export const consumableStock = {
  calculateRemainingStock(currentRemaining: number, quantityUsed: number): number {
    return roundStock(currentRemaining - quantityUsed);
  },

  calculateProductQuantity(remainingStock: number, unitSize?: number | null): number {
    return roundStock(unitSize && unitSize > 0 ? remainingStock / unitSize : remainingStock);
  },

  calculateStockStatus(productQuantity: number, lowStockThreshold?: number | null): ConsumableStockStatus {
    if (productQuantity <= 0) return "out_of_stock";
    return productQuantity <= (lowStockThreshold ?? 0) ? "low_stock" : "healthy";
  },

  calculateLowStock(productQuantity: number, lowStockThreshold?: number | null): boolean {
    return productQuantity > 0 && productQuantity <= (lowStockThreshold ?? 0);
  },
};

export const consumableStockSql = {
  productQuantity(alias = "p"): string {
    return `(CASE WHEN ${alias}.bottle_size IS NOT NULL AND ${alias}.bottle_size > 0
      THEN COALESCE(${alias}.amount, 0) / ${alias}.bottle_size
      ELSE COALESCE(${alias}.amount, 0) END)`;
  },

  stockStatus(alias = "p"): string {
    const quantity = this.productQuantity(alias);
    return `(CASE WHEN ${quantity} <= 0 THEN 'out_of_stock'
      WHEN ${quantity} <= COALESCE(${alias}.qty_alert, 0) THEN 'low_stock'
      ELSE 'healthy' END)`;
  },
};
