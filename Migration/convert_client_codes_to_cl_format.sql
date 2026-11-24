-- Brings EXISTING clients in line with the new Client Code format, CL000:
--   * the plain numbers this system used to hand out ("1", "2", ... "72")  ->  "CL001", "CL002", ... "CL072"
--   * clients that have no code at all                                      ->  the next CL code for their salon, oldest first
--
-- New clients already get a CL code automatically (clients.repository.ts create -> clientCode.ts), so this is NOT needed
-- for the feature to work: until it is run, a new client simply carries on after the highest number the salon has
-- (72 is followed by CL073). Run it when you want one consistent format on the clients that already exist.
--
-- Codes in any other shape (typed by hand, e.g. "VIP-7") are never changed. Safe to run more than once.
-- It takes the same per-salon lock the app takes when it assigns a code, so a client being created at that moment
-- waits until this commits instead of racing it.
--
-- Preview what it will change, before running:
--   SELECT salon_id, client_code, 'CL' || CASE WHEN client_code::bigint < 1000 THEN LPAD(client_code::bigint::text, 3, '0')
--          ELSE client_code::bigint::text END AS new_code
--   FROM clients WHERE client_code ~ '^[0-9]{1,9}$' AND client_code::bigint > 0 ORDER BY salon_id, client_code::bigint;
BEGIN;

SELECT pg_advisory_xact_lock(hashtext('client-code:' || salon_id::text))
FROM (SELECT DISTINCT salon_id FROM clients) s;

-- 1) Plain numbers -> CL codes. "7" and "007" would both become CL007, so only the oldest of such a pair is converted,
--    and nothing is converted onto a CL code the salon already has. A bare "0" is left alone.
WITH digit_codes AS (
    SELECT id, salon_id, client_code::bigint AS n, created_at
    FROM clients
    WHERE client_code ~ '^[0-9]{1,9}$' AND client_code::bigint > 0
),
ranked AS (
    SELECT id, salon_id, n,
           ROW_NUMBER() OVER (PARTITION BY salon_id, n ORDER BY created_at, id) AS rn
    FROM digit_codes
),
target AS (
    -- LPAD would cut a longer number down to 3 characters, so it is only applied below 1000.
    SELECT id, salon_id,
           'CL' || CASE WHEN n < 1000 THEN LPAD(n::text, 3, '0') ELSE n::text END AS new_code
    FROM ranked
    WHERE rn = 1
)
UPDATE clients c
SET client_code = t.new_code
FROM target t
WHERE c.id = t.id
  AND NOT EXISTS (
      SELECT 1 FROM clients x
      WHERE x.salon_id = c.salon_id AND UPPER(x.client_code) = t.new_code AND x.id <> c.id
  );

-- 2) Clients with no code -> the next numbers for their salon, continuing after the highest one in use.
WITH base AS (
    SELECT salon_id,
           MAX(CASE
                 WHEN client_code ~ '^[0-9]{1,9}$'    THEN client_code::bigint
                 WHEN client_code ~* '^CL[0-9]{1,9}$' THEN SUBSTRING(client_code FROM 3)::bigint
               END) AS max_n
    FROM clients
    GROUP BY salon_id
),
todo AS (
    SELECT c.id,
           COALESCE(b.max_n, 0) + ROW_NUMBER() OVER (PARTITION BY c.salon_id ORDER BY c.created_at, c.id) AS n
    FROM clients c
    LEFT JOIN base b ON b.salon_id = c.salon_id
    WHERE c.client_code IS NULL OR BTRIM(c.client_code) = ''
)
UPDATE clients c
SET client_code = 'CL' || CASE WHEN todo.n < 1000 THEN LPAD(todo.n::text, 3, '0') ELSE todo.n::text END
FROM todo
WHERE c.id = todo.id;

COMMIT;
