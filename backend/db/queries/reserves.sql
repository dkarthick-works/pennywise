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

-- name: LockReservesForDeposit :many
SELECT * FROM reserves
WHERE user_id = sqlc.arg(user_id)
  AND id = ANY(sqlc.arg(reserve_ids)::uuid[])
ORDER BY id
FOR UPDATE;

-- name: InsertReserveOperation :one
INSERT INTO reserve_operations (user_id, operation_type, occurred_on, description, note)
VALUES (sqlc.arg(user_id), sqlc.arg(operation_type), sqlc.arg(occurred_on), sqlc.arg(description), sqlc.arg(note))
RETURNING *;

-- name: InsertReserveEntry :one
INSERT INTO reserve_entries (operation_id, reserve_id, direction, amount)
VALUES (sqlc.arg(operation_id), sqlc.arg(reserve_id), sqlc.arg(direction), sqlc.arg(amount))
RETURNING *;

-- name: ListDepositOperationHistory :many
SELECT o.id, o.operation_type, o.occurred_on, o.description, o.note, o.created_at, o.updated_at,
       e.id AS entry_id, e.reserve_id, r.name AS reserve_name, e.direction, e.amount
FROM reserve_operations o
JOIN reserve_entries e ON e.operation_id = o.id
JOIN reserves r ON r.id = e.reserve_id
WHERE o.user_id = sqlc.arg(user_id)
  AND o.operation_type = 'deposit'
  AND o.occurred_on >= sqlc.arg(from_date)
  AND o.occurred_on < sqlc.arg(to_date)
  AND (
    sqlc.arg(reserve_id)::text = ''
    OR EXISTS (
      SELECT 1 FROM reserve_entries filtered
      WHERE filtered.operation_id = o.id
        AND filtered.reserve_id = sqlc.arg(reserve_id)::uuid
    )
  )
ORDER BY o.occurred_on DESC, o.created_at DESC, o.id DESC, r.name, e.id;
