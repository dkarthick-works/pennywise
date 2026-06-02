-- name: GetMonthState :one
SELECT * FROM month_state WHERE user_id = $1 AND month = $2;

-- name: ListMonthStates :many
SELECT * FROM month_state WHERE user_id = $1 ORDER BY month;

-- name: UpsertMonthClosed :one
INSERT INTO month_state (user_id, month, closed)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, month) DO UPDATE
    SET closed = EXCLUDED.closed
RETURNING *;

-- name: MarkMonthSeeded :one
INSERT INTO month_state (user_id, month, seeded)
VALUES ($1, $2, true)
ON CONFLICT (user_id, month) DO UPDATE
    SET seeded = true
RETURNING *;
