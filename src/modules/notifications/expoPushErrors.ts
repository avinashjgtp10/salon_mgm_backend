export function shouldRemoveTokenForExpoError(errorCode: string | undefined): boolean {
  if (!errorCode) return false;
  return [
    "DeviceNotRegistered",
    "InvalidPushToken",
    "SENDER_ID_MISMATCH",
    "SenderIdMismatch",
    "MismatchSenderId",
    "InvalidRegistration",
    "NotRegistered",
  ].includes(errorCode);
}

export function isCredentialOrProjectMismatchError(errorCode: string | undefined): boolean {
  if (!errorCode) return false;
  return [
    "InvalidCredentials",
    "SENDER_ID_MISMATCH",
    "SenderIdMismatch",
    "MismatchSenderId",
  ].includes(errorCode);
}

export function normalizeExpoErrorCode(err: any): string {
  const code =
    err?.details?.error ??
    err?.errorCode ??
    err?.code ??
    err?.response?.data?.errors?.[0]?.code ??
    err?.response?.data?.errors?.[0]?.details?.error;

  if (typeof code === "string" && code.trim()) return code.trim();

  const message = String(err?.message ?? "");
  if (message.includes("SENDER_ID_MISMATCH")) return "SENDER_ID_MISMATCH";
  if (message.toLowerCase().includes("sender id mismatch")) return "SENDER_ID_MISMATCH";
  if (message.includes("same project")) return "ExpoProjectMismatch";
  return "ExpoRequestError";
}
