import { consumablesRepository } from "./consumables.repository";
import { ConsumableUsageRequest } from "./consumables.types";

export const consumablesService = {
  usage(request: ConsumableUsageRequest) {
    return consumablesRepository.usage(request);
  },
};
