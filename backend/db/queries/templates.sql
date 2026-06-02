-- name: ListTemplates :many
SELECT * FROM templates
WHERE user_id = $1
ORDER BY section, position;

-- name: ListTemplatesBySection :many
SELECT * FROM templates
WHERE user_id = $1 AND section = $2
ORDER BY position;

-- name: DeleteTemplatesBySection :exec
DELETE FROM templates
WHERE user_id = $1 AND section = $2;

-- name: InsertTemplate :one
INSERT INTO templates (user_id, section, label, position)
VALUES ($1, $2, $3, $4)
RETURNING *;
