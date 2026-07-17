-- name: ListPopularTransactionNameSuggestions :many
SELECT display_name
FROM transaction_name_suggestions
WHERE user_id = sqlc.arg(user_id)
  AND section = sqlc.arg(section)
ORDER BY use_count DESC, last_used_at DESC, display_name ASC
LIMIT sqlc.arg(result_limit);

-- name: SearchShortTransactionNameSuggestions :many
WITH normalized_input AS (
    SELECT lower(
        regexp_replace(btrim(sqlc.arg(search)::text), '[[:space:]]+', ' ', 'g')
    ) AS value
)
SELECT tns.display_name
FROM transaction_name_suggestions tns
CROSS JOIN normalized_input ni
WHERE tns.user_id = sqlc.arg(user_id)
  AND tns.section = sqlc.arg(section)
  AND tns.normalized_name LIKE ni.value || '%'
ORDER BY
    (tns.normalized_name = ni.value) DESC,
    tns.use_count DESC,
    tns.last_used_at DESC,
    tns.display_name ASC
LIMIT sqlc.arg(result_limit);

-- name: SearchTransactionNameSuggestions :many
WITH normalized_input AS (
    SELECT lower(
        regexp_replace(btrim(sqlc.arg(search)::text), '[[:space:]]+', ' ', 'g')
    ) AS value
)
SELECT tns.display_name
FROM transaction_name_suggestions tns
CROSS JOIN normalized_input ni
WHERE tns.user_id = sqlc.arg(user_id)
  AND tns.section = sqlc.arg(section)
  AND (
      tns.normalized_name LIKE '%' || ni.value || '%'
      OR tns.normalized_name % ni.value
  )
ORDER BY
    (tns.normalized_name = ni.value) DESC,
    (tns.normalized_name LIKE ni.value || '%') DESC,
    (tns.normalized_name LIKE '%' || ni.value || '%') DESC,
    similarity(tns.normalized_name, ni.value) DESC,
    tns.use_count DESC,
    tns.last_used_at DESC,
    tns.display_name ASC
LIMIT sqlc.arg(result_limit);
