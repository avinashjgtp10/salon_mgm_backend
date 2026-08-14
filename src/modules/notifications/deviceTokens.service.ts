import { AppError } from "../../middleware/error.middleware";
import {
  DevicePlatform,
  DeviceToken,
  deviceTokensRepository,
} from "./deviceTokens.repository";
import { pushNotificationService } from "./pushNotification.service";

export interface RegisterExpoPushTokenParams {
  user_id: string;
  salon_id: string;
  expo_push_token: string;
  platform: DevicePlatform;
  installation_id?: string | null;
}

export const deviceTokensService = {
  async registerExpoPushToken(data: RegisterExpoPushTokenParams): Promise<DeviceToken> {
    const expoPushToken = data.expo_push_token?.trim();

    if (!data.user_id) {
      throw new AppError(400, "user_id is required", "VALIDATION_ERROR");
    }
    if (!data.salon_id) {
      throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    }
    if (!expoPushToken) {
      throw new AppError(400, "expo_push_token is required", "VALIDATION_ERROR");
    }
    if (!(await pushNotificationService.isValidExpoPushToken(expoPushToken))) {
      throw new AppError(400, "Invalid Expo push token", "VALIDATION_ERROR");
    }
    if (!isDevicePlatform(data.platform)) {
      throw new AppError(400, "platform must be android or ios", "VALIDATION_ERROR");
    }

    return deviceTokensRepository.registerToken({
      user_id: data.user_id,
      salon_id: data.salon_id,
      expo_push_token: expoPushToken,
      platform: data.platform,
      installation_id: normalizeInstallationId(data.installation_id),
    });
  },

  async updateExistingToken(data: RegisterExpoPushTokenParams): Promise<DeviceToken> {
    return this.registerExpoPushToken(data);
  },

  async removeToken(expoPushToken: string): Promise<void> {
    const token = expoPushToken?.trim();
    if (!token) {
      throw new AppError(400, "expo_push_token is required", "VALIDATION_ERROR");
    }
    await deviceTokensRepository.removeToken(token);
  },

  async getSalonTokens(salonId: string): Promise<DeviceToken[]> {
    if (!salonId) {
      throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    }
    return deviceTokensRepository.findBySalon(salonId);
  },

  async getUserTokens(userId: string): Promise<DeviceToken[]> {
    if (!userId) {
      throw new AppError(400, "user_id is required", "VALIDATION_ERROR");
    }
    return deviceTokensRepository.getUserTokens(userId);
  },
};

function isDevicePlatform(platform: string): platform is DevicePlatform {
  return platform === "android" || platform === "ios";
}

function normalizeInstallationId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
