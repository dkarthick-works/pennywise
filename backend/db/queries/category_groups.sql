-- name: ListCategoryGroups :many
SELECT * FROM category_groups
WHERE user_id = $1
ORDER BY name;

-- name: GetCategoryGroup :one
SELECT * FROM category_groups
WHERE id = $1 AND user_id = $2;

-- name: InsertCategoryGroup :one
INSERT INTO category_groups (user_id, name, normalized_name)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateCategoryGroupName :one
UPDATE category_groups
SET name = $3,
    normalized_name = $4,
    updated_at = now()
WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteCategoryGroup :exec
DELETE FROM category_groups
WHERE id = $1 AND user_id = $2;

-- name: CountCategoryMappingsForGroup :one
SELECT COUNT(*)::bigint AS count
FROM category_mappings
WHERE group_id = $1 AND user_id = $2;

-- name: SumSpendByGroupsForMonth :many
SELECT
    cg.id AS group_id,
    cg.name AS group_name,
    COALESCE(SUM(t.amount), 0)::numeric AS total
FROM category_groups cg
LEFT JOIN category_mappings cm
    ON cm.group_id = cg.id AND cm.user_id = cg.user_id
LEFT JOIN transactions t
    ON t.user_id = cg.user_id
    AND lower(regexp_replace(btrim(t.category), '\s+', ' ', 'g')) = cm.normalized_category
    AND t.txn_date >= sqlc.arg(from_date)
    AND t.txn_date < sqlc.arg(to_date)
WHERE cg.user_id = sqlc.arg(user_id)
GROUP BY cg.id, cg.name;

-- name: ListUnmappedCategoryTexts :many
SELECT DISTINCT t.category
FROM transactions t
WHERE t.user_id = $1
  AND btrim(t.category) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM category_mappings cm
      WHERE cm.user_id = t.user_id
        AND cm.normalized_category = lower(regexp_replace(btrim(t.category), '\s+', ' ', 'g'))
  )
ORDER BY t.category;

-- name: ListTransactionCategoryTexts :many
SELECT MIN(t.category)::text AS category
FROM transactions t
WHERE t.user_id = @user_id
  AND btrim(t.category) <> ''
  AND (sqlc.narg('search')::text IS NULL OR t.category ILIKE '%' || sqlc.narg('search') || '%')
  AND (sqlc.narg('exclude_group_id')::uuid IS NULL OR NOT EXISTS (
      SELECT 1 FROM category_mappings cm
      WHERE cm.user_id = t.user_id
        AND cm.group_id = sqlc.narg('exclude_group_id')
        AND cm.normalized_category = lower(regexp_replace(btrim(t.category), '\s+', ' ', 'g'))
  ))
GROUP BY lower(regexp_replace(btrim(t.category), '\s+', ' ', 'g'))
ORDER BY MIN(t.category)
LIMIT sqlc.arg('limit');

-- name: CategoryTextExistsForUser :one
SELECT EXISTS (
    SELECT 1 FROM transactions
    WHERE user_id = $1
      AND lower(regexp_replace(btrim(category), '\s+', ' ', 'g')) = $2
) AS exists;

-- name: ListCategoryMappings :many
SELECT
    cm.id,
    cm.user_id,
    cm.raw_category,
    cm.normalized_category,
    cm.group_id,
    cm.created_at,
    cm.updated_at,
    cg.name AS group_name
FROM category_mappings cm
JOIN category_groups cg ON cg.id = cm.group_id
WHERE cm.user_id = $1
ORDER BY cg.name, cm.raw_category;

-- name: ListCategoryMappingsByGroup :many
SELECT * FROM category_mappings
WHERE group_id = $1 AND user_id = $2
ORDER BY raw_category;

-- name: GetCategoryMapping :one
SELECT * FROM category_mappings
WHERE id = $1 AND user_id = $2;

-- name: InsertCategoryMapping :one
INSERT INTO category_mappings (user_id, raw_category, normalized_category, group_id)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: DeleteCategoryMapping :exec
DELETE FROM category_mappings
WHERE id = $1 AND user_id = $2;
