-- name: GetEvent :one
SELECT * FROM events WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL;

-- name: LockEvent :one
SELECT * FROM events WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE;

-- name: CreateEvent :one
INSERT INTO events(user_id,name,note,target_date,status,suggestions_enabled)
VALUES ($1,$2,$3,$4,$5,$6) RETURNING *;

-- name: UpdateEvent :one
UPDATE events SET name=$3,note=$4,target_date=$5,status=$6,suggestions_enabled=$7,version=version+1,updated_at=now()
WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING *;

-- name: SoftDeleteEvent :exec
UPDATE events SET deleted_at=now(),updated_at=now(),version=version+1 WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL;

-- name: ListEventItems :many
SELECT i.* FROM event_items i JOIN events e ON e.id=i.event_id
WHERE e.id=$1 AND e.user_id=$2 AND e.deleted_at IS NULL ORDER BY i.position;

-- name: DeleteMissingEventItems :exec
DELETE FROM event_items WHERE event_id=$1 AND NOT (id=ANY(sqlc.arg(retained_ids)::uuid[]));

-- name: SaveEventItem :exec
INSERT INTO event_items(id,event_id,name,expected_cost,actual_cost,position)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,expected_cost=EXCLUDED.expected_cost,
actual_cost=EXCLUDED.actual_cost,position=EXCLUDED.position,updated_at=now()
WHERE event_items.event_id=EXCLUDED.event_id;

-- name: ListEvents :many
SELECT e.*, COUNT(i.id)::bigint AS item_count,
 COALESCE(SUM(i.expected_cost),0)::numeric AS expected_total,
 COALESCE(SUM(i.actual_cost),0)::numeric AS actual_total,
 COUNT(i.id) FILTER (WHERE i.expected_cost IS NULL)::bigint AS missing_expected_count,
 COUNT(i.id) FILTER (WHERE i.actual_cost IS NULL)::bigint AS missing_actual_count
FROM events e LEFT JOIN event_items i ON i.event_id=e.id
WHERE e.user_id=sqlc.arg(user_id) AND e.deleted_at IS NULL
 AND (sqlc.arg(status_filter)::text='' OR e.status=sqlc.arg(status_filter))
 AND (NOT sqlc.arg(suggestions)::boolean OR (e.status='planned' AND e.suggestions_enabled AND (e.target_date IS NULL OR e.target_date < sqlc.arg(before_date)::date)))
GROUP BY e.id
HAVING NOT sqlc.arg(suggestions)::boolean OR
 (COUNT(i.id)>0 AND COUNT(i.id) FILTER (WHERE i.expected_cost IS NULL)=0 AND SUM(i.expected_cost)<=sqlc.arg(allowance)::numeric)
ORDER BY CASE WHEN sqlc.arg(suggestions)::boolean THEN e.target_date END ASC NULLS LAST,
 e.created_at DESC,e.id
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
