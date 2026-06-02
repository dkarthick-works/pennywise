-- name: ListTransactionsByMonth :many
SELECT * FROM transactions
WHERE user_id = $1 AND to_char(txn_date, 'YYYY-MM') = sqlc.arg(month)::text
ORDER BY txn_date, created_at;

-- name: ListTransactionsByMonthSection :many
SELECT * FROM transactions
WHERE user_id = $1
  AND to_char(txn_date, 'YYYY-MM') = sqlc.arg(month)::text
  AND section = $2
ORDER BY txn_date, created_at;

-- name: ListTransactionsByYear :many
SELECT * FROM transactions
WHERE user_id = $1 AND to_char(txn_date, 'YYYY') = sqlc.arg(year)::text
ORDER BY txn_date, created_at;

-- name: GetTransaction :one
SELECT * FROM transactions
WHERE id = $1 AND user_id = $2;

-- name: InsertTransaction :one
INSERT INTO transactions (user_id, section, category, amount, txn_date, kind)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateTransaction :one
UPDATE transactions
SET section    = $3,
    category   = $4,
    amount     = $5,
    txn_date   = $6,
    kind       = $7,
    updated_at = now()
WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteTransaction :exec
DELETE FROM transactions
WHERE id = $1 AND user_id = $2;

-- name: DailyCategorySuggestions :many
-- Distinct non-settlement daily categories for ghost autocomplete.
SELECT DISTINCT category FROM transactions
WHERE user_id = $1 AND section = 'daily' AND kind <> 'settlement' AND category <> ''
ORDER BY category;

-- name: IncomeCategorySuggestions :many
-- Distinct income source categories for ghost autocomplete.
SELECT DISTINCT category FROM transactions
WHERE user_id = $1 AND section = 'income' AND category <> ''
ORDER BY category;

-- ---- settlement links --------------------------------------------------

-- name: ListSettlementLinksByMonth :many
-- All (settlement_id, credit_id) pairs where the SETTLEMENT falls in the month.
SELECT sl.settlement_id, sl.credit_id
FROM settlement_links sl
JOIN transactions s ON s.id = sl.settlement_id
WHERE s.user_id = $1 AND to_char(s.txn_date, 'YYYY-MM') = sqlc.arg(month)::text;

-- name: ListSettlementLinksByYear :many
SELECT sl.settlement_id, sl.credit_id
FROM settlement_links sl
JOIN transactions s ON s.id = sl.settlement_id
WHERE s.user_id = $1 AND to_char(s.txn_date, 'YYYY') = sqlc.arg(year)::text;

-- name: ListLinksForSettlement :many
SELECT credit_id FROM settlement_links WHERE settlement_id = $1;

-- name: DeleteSettlementLinks :exec
DELETE FROM settlement_links WHERE settlement_id = $1;

-- name: InsertSettlementLink :exec
INSERT INTO settlement_links (settlement_id, credit_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: SettledCreditIdsByMonth :many
-- Credit ids (in this month) that some settlement references — for "Settled" chips.
SELECT DISTINCT sl.credit_id
FROM settlement_links sl
JOIN transactions c ON c.id = sl.credit_id
WHERE c.user_id = $1 AND to_char(c.txn_date, 'YYYY-MM') = sqlc.arg(month)::text;

-- name: OpenCreditsForSection :many
-- Open (unsettled) credits in a section, newest first — candidates for a settlement
-- picker. Excludes any credit already linked to a settlement other than the one
-- currently being edited (exclude_settlement).
SELECT t.* FROM transactions t
WHERE t.user_id = $1
  AND t.section = $2
  AND t.kind = 'credit'
  AND NOT EXISTS (
      SELECT 1 FROM settlement_links sl
      WHERE sl.credit_id = t.id
        AND sl.settlement_id <> sqlc.arg(exclude_settlement)
  )
ORDER BY t.txn_date DESC, t.created_at DESC;
