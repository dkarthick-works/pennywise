-- name: GetUserIsAdmin :one
SELECT is_admin FROM users WHERE id = $1;

-- name: ListAdminUsers :many
-- Opening a month creates amount = 0 template rows, so only non-zero rows count.
SELECT
    u.id,
    u.email,
    u.display_name,
    u.created_at,
    (
        SELECT COUNT(*)
        FROM transactions t
        WHERE t.user_id = u.id AND t.amount > 0
    )::bigint AS transaction_count
FROM users u
ORDER BY u.created_at DESC, u.id
LIMIT $1 OFFSET $2;

-- name: GetAdminSummary :one
SELECT
    (SELECT COUNT(*) FROM users)::bigint AS total_users,
    (SELECT COUNT(*) FROM transactions WHERE amount > 0)::bigint AS total_transactions;
