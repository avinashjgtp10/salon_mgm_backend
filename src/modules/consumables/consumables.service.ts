import { consumablesRepository } from "./consumables.repository";
import { ConsumableUsageHistoryFilters, ConsumableUsageRequest } from "./consumables.types";

export const consumablesService = {
  history(salonId: string, filters: ConsumableUsageHistoryFilters) {
    return consumablesRepository.history(salonId, filters);
  },

  usage(request: ConsumableUsageRequest) {
    return consumablesRepository.usage(request);
  },
};
