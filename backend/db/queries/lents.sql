-- name: ListLents :many
SELECT l.id, l.user_id, l.counterparty, l.amount, l.lent_on, l.due_on, l.note,
       COALESCE(r.total, 0)::numeric            AS repaid_total,
       (l.amount - COALESCE(r.total, 0))::numeric AS outstanding
FROM lents l
LEFT JOIN (
    SELECT lent_id, SUM(amount) AS total FROM lent_repayments GROUP BY lent_id
) r ON r.lent_id = l.id
WHERE l.user_id = sqlc.arg(user_id)
  AND (
    sqlc.arg(status)::text = 'all'
    OR (sqlc.arg(status)::text = 'open'    AND l.amount - COALESCE(r.total, 0) > 0)
    OR (sqlc.arg(status)::text = 'settled' AND l.amount - COALESCE(r.total, 0) <= 0)
  )
ORDER BY l.lent_on DESC, l.created_at DESC;

-- name: GetLent :one
SELECT l.id, l.user_id, l.counterparty, l.amount, l.lent_on, l.due_on, l.note,
       COALESCE(r.total, 0)::numeric            AS repaid_total,
       (l.amount - COALESCE(r.total, 0))::numeric AS outstanding
FROM lents l
LEFT JOIN (
    SELECT lent_id, SUM(amount) AS total FROM lent_repayments GROUP BY lent_id
) r ON r.lent_id = l.id
WHERE l.id = sqlc.arg(id) AND l.user_id = sqlc.arg(user_id);

-- name: InsertLent :one
INSERT INTO lents (user_id, counterparty, amount, lent_on, due_on, note)
VALUES (sqlc.arg(user_id), sqlc.arg(counterparty), sqlc.arg(amount), sqlc.arg(lent_on), sqlc.narg(due_on), sqlc.arg(note))
RETURNING *;

-- name: UpdateLent :one
UPDATE lents
SET counterparty = sqlc.arg(counterparty),
    amount       = sqlc.arg(amount),
    lent_on      = sqlc.arg(lent_on),
    due_on       = sqlc.narg(due_on),
    note         = sqlc.arg(note),
    updated_at   = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id)
RETURNING *;

-- name: DeleteLent :execrows
DELETE FROM lents WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- name: SumLentOutstanding :one
SELECT
    COUNT(*)::bigint                                        AS open_count,
    COALESCE(SUM(l.amount - COALESCE(r.total, 0)), 0)::numeric AS outstanding_total
FROM lents l
LEFT JOIN (
    SELECT lent_id, SUM(amount) AS total FROM lent_repayments GROUP BY lent_id
) r ON r.lent_id = l.id
WHERE l.user_id = sqlc.arg(user_id)
  AND l.amount - COALESCE(r.total, 0) > 0;

-- name: ListRepaymentsForLent :many
SELECT r.id, r.lent_id, r.amount, r.repaid_on, r.note
FROM lent_repayments r
JOIN lents l ON l.id = r.lent_id
WHERE r.lent_id = sqlc.arg(lent_id) AND l.user_id = sqlc.arg(user_id)
ORDER BY r.repaid_on ASC, r.created_at ASC;

-- name: InsertRepayment :one
INSERT INTO lent_repayments (lent_id, amount, repaid_on, note)
SELECT sqlc.arg(lent_id), sqlc.arg(amount), sqlc.arg(repaid_on), sqlc.arg(note)
FROM lents l
WHERE l.id = sqlc.arg(lent_id) AND l.user_id = sqlc.arg(user_id)
RETURNING *;

-- name: UpdateRepayment :one
UPDATE lent_repayments r
SET amount    = sqlc.arg(amount),
    repaid_on = sqlc.arg(repaid_on),
    note      = sqlc.arg(note)
FROM lents l
WHERE r.id = sqlc.arg(id)
  AND r.lent_id = sqlc.arg(lent_id)
  AND l.id = r.lent_id
  AND l.user_id = sqlc.arg(user_id)
RETURNING r.*;

-- name: DeleteRepayment :execrows
DELETE FROM lent_repayments r
USING lents l
WHERE r.id = sqlc.arg(id)
  AND r.lent_id = sqlc.arg(lent_id)
  AND l.id = r.lent_id
  AND l.user_id = sqlc.arg(user_id);

-- name: SumRepaymentsForLent :one
-- Total already repaid against a lent, optionally excluding one repayment row
-- (used when editing an existing repayment so it does not count against itself).
SELECT COALESCE(SUM(r.amount), 0)::numeric AS repaid_total
FROM lent_repayments r
WHERE r.lent_id = sqlc.arg(lent_id)
  AND r.id <> sqlc.arg(exclude_id);
