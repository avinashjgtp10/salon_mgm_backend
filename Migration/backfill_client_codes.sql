-- Gives every existing client that has no client code the next number for its salon: 1, 2, 3, ... in the order the clients
-- were created, continuing after the highest all-digit code the salon already uses. Codes typed by hand are never changed.
-- Safe to run more than once (only clients with an empty code are touched).
WITH base AS (
    SELECT salon_id, COALESCE(MAX(client_code::bigint), 0) AS max_code
    FROM clients
    WHERE client_code ~ '^[0-9]{1,9}$'
    GROUP BY salon_id
),
todo AS (
    SELECT c.id,
           COALESCE(b.max_code, 0) + ROW_NUMBER() OVER (PARTITION BY c.salon_id ORDER BY c.created_at, c.id) AS n
    FROM clients c
    LEFT JOIN base b ON b.salon_id = c.salon_id
    WHERE c.client_code IS NULL OR BTRIM(c.client_code) = ''
)
UPDATE clients c SET client_code = todo.n::text
FROM todo
WHERE c.id = todo.id;
