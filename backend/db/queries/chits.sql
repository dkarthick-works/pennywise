-- name: ListChits :many
SELECT
    c.id,
    c.user_id,
    c.name,
    c.organizer,
    c.chit_value,
    c.expected_monthly,
    c.total_installments,
    c.start_month,
    c.created_at,
    c.updated_at,
    COUNT(i.id)::bigint AS installment_count,
    COALESCE(SUM(i.amount), 0)::numeric AS total_paid
FROM chits c
LEFT JOIN chit_installments i ON i.chit_id = c.id
WHERE c.user_id = sqlc.arg(user_id)
GROUP BY c.id
ORDER BY c.created_at DESC;

-- name: GetChit :one
SELECT
    c.id,
    c.user_id,
    c.name,
    c.organizer,
    c.chit_value,
    c.expected_monthly,
    c.total_installments,
    c.start_month,
    c.created_at,
    c.updated_at,
    COUNT(i.id)::bigint AS installment_count,
    COALESCE(SUM(i.amount), 0)::numeric AS total_paid
FROM chits c
LEFT JOIN chit_installments i ON i.chit_id = c.id
WHERE c.id = sqlc.arg(id) AND c.user_id = sqlc.arg(user_id)
GROUP BY c.id;

-- name: LockChitForUser :one
SELECT id, user_id, name, organizer, chit_value, expected_monthly,
       total_installments, start_month, created_at, updated_at
FROM chits
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id)
FOR UPDATE;

-- name: CountInstallmentsForChit :one
SELECT COUNT(*)::bigint AS installment_count
FROM chit_installments
WHERE chit_id = sqlc.arg(chit_id);

-- name: InsertChit :one
INSERT INTO chits (
    user_id, name, organizer, chit_value, expected_monthly,
    total_installments, start_month
)
VALUES (
    sqlc.arg(user_id), sqlc.arg(name), sqlc.arg(organizer),
    sqlc.arg(chit_value), sqlc.arg(expected_monthly),
    sqlc.arg(total_installments), sqlc.arg(start_month)
)
RETURNING *;

-- name: UpdateChit :one
UPDATE chits
SET name               = sqlc.arg(name),
    organizer          = sqlc.arg(organizer),
    chit_value         = sqlc.arg(chit_value),
    expected_monthly   = sqlc.arg(expected_monthly),
    total_installments = sqlc.arg(total_installments),
    start_month        = sqlc.arg(start_month),
    updated_at         = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id)
RETURNING *;

-- name: DeleteChit :execrows
DELETE FROM chits WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- name: ListInstallmentsForChit :many
SELECT i.id, i.chit_id, i.amount, i.paid_on, i.note, i.created_at
FROM chit_installments i
JOIN chits c ON c.id = i.chit_id
WHERE i.chit_id = sqlc.arg(chit_id) AND c.user_id = sqlc.arg(user_id)
ORDER BY i.paid_on ASC, i.created_at ASC, i.id ASC;

-- name: InsertChitInstallment :one
INSERT INTO chit_installments (chit_id, amount, paid_on, note)
SELECT sqlc.arg(chit_id), sqlc.arg(amount), sqlc.arg(paid_on), sqlc.arg(note)
FROM chits c
WHERE c.id = sqlc.arg(chit_id) AND c.user_id = sqlc.arg(user_id)
RETURNING *;

-- name: UpdateChitInstallment :one
UPDATE chit_installments i
SET amount  = sqlc.arg(amount),
    paid_on = sqlc.arg(paid_on),
    note    = sqlc.arg(note)
FROM chits c
WHERE i.id = sqlc.arg(id)
  AND i.chit_id = sqlc.arg(chit_id)
  AND c.id = i.chit_id
  AND c.user_id = sqlc.arg(user_id)
RETURNING i.*;

-- name: DeleteChitInstallment :execrows
DELETE FROM chit_installments i
USING chits c
WHERE i.id = sqlc.arg(id)
  AND i.chit_id = sqlc.arg(chit_id)
  AND c.id = i.chit_id
  AND c.user_id = sqlc.arg(user_id);
