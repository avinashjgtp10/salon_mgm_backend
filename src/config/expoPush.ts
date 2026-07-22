export const expoPushConfig = {
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  maxConcurrentRequests: Number(process.env.EXPO_MAX_CONCURRENT_REQUESTS || 6),
  retryMinTimeout: Number(process.env.EXPO_RETRY_MIN_TIMEOUT || 1000),
};
