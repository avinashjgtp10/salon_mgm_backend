// Client codes: "CL" + the salon's running number, at least three digits — CL001, CL002 ... CL999, CL1000 ...
// Numbering is per salon (every salon starts at CL001), and every way a client can be created ends up in
// clientsRepository.create(), which assigns the next code there when none was typed.

export const CLIENT_CODE_PREFIX = "CL";

/** 1 -> "CL001", 42 -> "CL042", 999 -> "CL999", 1000 -> "CL1000" (it grows past three digits rather than wrapping). */
export const formatClientCode = (n: number): string => `${CLIENT_CODE_PREFIX}${String(n).padStart(3, "0")}`;

/**
 * The next number for a salon ($1 = salon id): one more than the highest number any of its clients already carries.
 * Both shapes count — CL-style codes ("CL042" -> 42) and the plain numbers this system handed out before the CL
 * format existed ("42" -> 42) — so a salon that has not been converted yet carries on from where it was
 * (…, "72" is followed by CL073) instead of restarting at CL001. Codes in any other shape (typed by hand) are ignored.
 * Must run while the per-salon client-code lock is held, or two clients created at once could read the same maximum.
 */
export const NEXT_CLIENT_NUMBER_SQL = `
  SELECT COALESCE(MAX(
           CASE
             WHEN client_code ~ '^[0-9]{1,9}$'     THEN client_code::bigint
             WHEN client_code ~* '^CL[0-9]{1,9}$'  THEN SUBSTRING(client_code FROM 3)::bigint
           END
         ), 0) + 1 AS n
  FROM clients
  WHERE salon_id = $1`;
