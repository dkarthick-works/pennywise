-- name: EnsureGeneralReserve :exec
INSERT INTO reserves (user_id, name, is_general)
VALUES (sqlc.arg(user_id), 'General Reserve', true)
ON CONFLICT (user_id) WHERE is_general DO NOTHING;

-- name: LockUserForReserveCount :one
SELECT id FROM users WHERE id = sqlc.arg(user_id) FOR UPDATE;

-- name: CountActiveReserves :one
SELECT COUNT(*)::bigint FROM reserves
WHERE user_id = sqlc.arg(user_id) AND archived_at IS NULL;

-- name: ListReserves :many
SELECT r.id, r.user_id, r.name, r.is_general, r.archived_at, r.created_at, r.updated_at,
       reserve_balance(r.id) AS balance
FROM reserves r
WHERE r.user_id = sqlc.arg(user_id)
  AND (sqlc.arg(include_archived)::boolean OR r.archived_at IS NULL)
ORDER BY (r.archived_at IS NOT NULL), r.is_general DESC, r.created_at, r.id;

-- name: GetReserveForUser :one
SELECT r.id, r.user_id, r.name, r.is_general, r.archived_at, r.created_at, r.updated_at,
       reserve_balance(r.id) AS balance
FROM reserves r
WHERE r.id = sqlc.arg(id) AND r.user_id = sqlc.arg(user_id);

-- name: GetReserveForUserForUpdate :one
SELECT * FROM reserves
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id)
FOR UPDATE;

-- name: CreateReserve :one
INSERT INTO reserves (user_id, name)
VALUES (sqlc.arg(user_id), sqlc.arg(name))
RETURNING *;

-- name: RenameReserve :one
UPDATE reserves
SET name = sqlc.arg(name), updated_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id)
RETURNING *;

-- name: ReserveNameExists :one
SELECT EXISTS (
  SELECT 1 FROM reserves r
  WHERE r.user_id = sqlc.arg(user_id) AND lower(r.name) = lower(sqlc.arg(name)) AND r.id <> sqlc.arg(exclude_id)
);

-- name: ReserveBalance :one
SELECT reserve_balance(sqlc.arg(reserve_id));
