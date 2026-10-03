-- Backfill Stock Ledger rows for completed branch-owner stock transfers made
-- before branch-owner.repository.ts#executeTransfer started writing them.
--
-- For every completed row in branch_stock_transfers that has no matching
-- transfer_out (source product) / transfer_in (destination product) ledger row
-- within 2 minutes of the transfer, this inserts the missing row dated at the
-- transfer's own time.
--
-- balance_after is an ESTIMATE: the exact historical balance wasn't recorded,
-- so it is the product's current stock minus every ledger movement logged
-- after the transfer (older transfers that have no ledger row can't be
-- subtracted, so treat the figure as approximate).
--
-- Safe to re-run: rows it inserts carry notes = 'backfill:branch_transfer:<id>'
-- and a repeat run finds them via the same 2-minute proximity check.
-- Review with the SELECT at the bottom first, then run the INSERTs.

BEGIN;

-- Transfer Out at the source salon
INSERT INTO stock_ledger (salon_id, branch_id, product_id, transaction_type, reference, quantity, balance_after, reason, notes, created_by, created_at, updated_at,
                          transfer_group_id, source_branch_id, destination_branch_id)
SELECT
    t.source_salon_id,
    (SELECT b.id FROM branches b WHERE b.salon_id = t.source_salon_id ORDER BY b.is_main DESC, b.created_at ASC LIMIT 1),
    t.source_product_id,
    'transfer_out',
    'Transfer Out → ' || COALESCE((SELECT COALESCE(s.business_name, s.slug) FROM salons s WHERE s.id = t.dest_salon_id), 'Unknown'),
    -t.quantity,
    GREATEST(0, COALESCE(p.amount, 0) - COALESCE((
        SELECT SUM(l.quantity) FROM stock_ledger l
         WHERE l.product_id = t.source_product_id AND l.created_at > t.created_at), 0)),
    t.reason,
    'backfill:branch_transfer:' || t.id,
    t.branch_owner_id,
    t.created_at,
    t.created_at,
    t.id,
    (SELECT b.id FROM branches b WHERE b.salon_id = t.source_salon_id ORDER BY b.is_main DESC, b.created_at ASC LIMIT 1),
    (SELECT b.id FROM branches b WHERE b.salon_id = t.dest_salon_id ORDER BY b.is_main DESC, b.created_at ASC LIMIT 1)
FROM branch_stock_transfers t
JOIN products p ON p.id = t.source_product_id
WHERE t.status = 'completed'
  AND (SELECT b.id FROM branches b WHERE b.salon_id = t.source_salon_id LIMIT 1) IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM stock_ledger l
       WHERE l.product_id = t.source_product_id
         AND l.transaction_type = 'transfer_out'
         AND l.created_at BETWEEN t.created_at - INTERVAL '2 minutes' AND t.created_at + INTERVAL '2 minutes');

-- Transfer In at the destination salon
INSERT INTO stock_ledger (salon_id, branch_id, product_id, transaction_type, reference, quantity, balance_after, reason, notes, created_by, created_at, updated_at,
                          transfer_group_id, source_branch_id, destination_branch_id)
SELECT
    t.dest_salon_id,
    (SELECT b.id FROM branches b WHERE b.salon_id = t.dest_salon_id ORDER BY b.is_main DESC, b.created_at ASC LIMIT 1),
    t.dest_product_id,
    'transfer_in',
    'Transfer In ← ' || COALESCE((SELECT COALESCE(s.business_name, s.slug) FROM salons s WHERE s.id = t.source_salon_id), 'Unknown'),
    t.quantity,
    GREATEST(0, COALESCE(p.amount, 0) - COALESCE((
        SELECT SUM(l.quantity) FROM stock_ledger l
         WHERE l.product_id = t.dest_product_id AND l.created_at > t.created_at), 0)),
    t.reason,
    'backfill:branch_transfer:' || t.id,
    t.branch_owner_id,
    t.created_at,
    t.created_at,
    t.id,
    (SELECT b.id FROM branches b WHERE b.salon_id = t.source_salon_id ORDER BY b.is_main DESC, b.created_at ASC LIMIT 1),
    (SELECT b.id FROM branches b WHERE b.salon_id = t.dest_salon_id ORDER BY b.is_main DESC, b.created_at ASC LIMIT 1)
FROM branch_stock_transfers t
JOIN products p ON p.id = t.dest_product_id
WHERE t.status = 'completed'
  AND (SELECT b.id FROM branches b WHERE b.salon_id = t.dest_salon_id LIMIT 1) IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM stock_ledger l
       WHERE l.product_id = t.dest_product_id
         AND l.transaction_type = 'transfer_in'
         AND l.created_at BETWEEN t.created_at - INTERVAL '2 minutes' AND t.created_at + INTERVAL '2 minutes');

COMMIT;

-- Check afterwards:
-- SELECT transaction_type, reference, quantity, balance_after, created_at
--   FROM stock_ledger WHERE notes LIKE 'backfill:branch_transfer:%' ORDER BY created_at DESC;
