-- name: SearchTransactions :many
WITH input AS (
    SELECT normalize_transaction_search(sqlc.arg(search)::text) AS value
), patterns AS (
    -- ! is the LIKE escape character; user wildcards remain literal.
    SELECT value, replace(replace(replace(value, '!', '!!'), '%', '!%'), '_', '!_') AS literal
    FROM input
), ranked AS (
    SELECT t.id, t.txn_date,
        CASE WHEN t.normalized_name = p.value THEN 0
             WHEN t.normalized_name LIKE p.literal || '%' ESCAPE '!' THEN 1
             WHEN t.normalized_name LIKE '%' || p.literal || '%' ESCAPE '!' THEN 2
             ELSE 3 END::integer AS match_tier,
        round((similarity(t.normalized_name, p.value) * 1000000)::numeric)::integer AS score
    FROM transactions t CROSS JOIN patterns p
    WHERE t.user_id = sqlc.arg(user_id)
      AND (sqlc.narg(section)::text IS NULL OR t.section::text = sqlc.narg(section)::text)
      AND (sqlc.narg(kind)::text IS NULL OR t.kind::text = sqlc.narg(kind)::text)
      AND (sqlc.narg(from_date)::date IS NULL OR t.txn_date >= sqlc.narg(from_date)::date)
      AND (sqlc.narg(to_date)::date IS NULL OR t.txn_date <= sqlc.narg(to_date)::date)
      AND (sqlc.narg(min_amount)::numeric IS NULL OR t.amount >= sqlc.narg(min_amount)::numeric)
      AND (sqlc.narg(max_amount)::numeric IS NULL OR t.amount <= sqlc.narg(max_amount)::numeric)
      AND (
          (char_length(p.value) < 3 AND t.normalized_name LIKE p.literal || '%' ESCAPE '!')
          OR (char_length(p.value) >= 3 AND (
              t.normalized_name LIKE '%' || p.literal || '%' ESCAPE '!'
              OR t.normalized_name % p.value
          ))
      )
), page AS MATERIALIZED (
    SELECT * FROM ranked
    WHERE NOT sqlc.arg(has_cursor)::boolean
        OR (sqlc.arg(sort_mode)::text = 'relevance' AND (
            match_tier > sqlc.arg(cursor_tier)::integer
            OR (match_tier = sqlc.arg(cursor_tier)::integer AND score < sqlc.arg(cursor_score)::integer)
            OR (match_tier = sqlc.arg(cursor_tier)::integer AND score = sqlc.arg(cursor_score)::integer
                AND (txn_date, id) < (sqlc.arg(cursor_date)::date, sqlc.arg(cursor_id)::uuid))
        ))
        OR (sqlc.arg(sort_mode)::text = 'date_desc'
            AND (txn_date, id) < (sqlc.arg(cursor_date)::date, sqlc.arg(cursor_id)::uuid))
        OR (sqlc.arg(sort_mode)::text = 'date_asc'
            AND (txn_date, id) > (sqlc.arg(cursor_date)::date, sqlc.arg(cursor_id)::uuid))
    ORDER BY
        CASE WHEN sqlc.arg(sort_mode)::text = 'relevance' THEN match_tier END,
        CASE WHEN sqlc.arg(sort_mode)::text = 'relevance' THEN score END DESC,
        CASE WHEN sqlc.arg(sort_mode)::text = 'date_asc' THEN txn_date END ASC,
        CASE WHEN sqlc.arg(sort_mode)::text = 'date_asc' THEN id END ASC,
        txn_date DESC, id DESC
    LIMIT sqlc.arg(result_limit)
)
SELECT sqlc.embed(t), page.match_tier, page.score,
    EXISTS (
        SELECT 1 FROM settlement_links sl
        JOIN transactions s ON s.id = sl.settlement_id
        WHERE sl.credit_id = t.id AND s.user_id = t.user_id
    ) AS settled,
    ARRAY (
        SELECT sl.credit_id FROM settlement_links sl
        JOIN transactions c ON c.id = sl.credit_id
        WHERE sl.settlement_id = t.id AND c.user_id = t.user_id
        ORDER BY sl.credit_id
    )::uuid[] AS settles
FROM page JOIN transactions t ON t.id = page.id
ORDER BY
    CASE WHEN sqlc.arg(sort_mode)::text = 'relevance' THEN page.match_tier END,
    CASE WHEN sqlc.arg(sort_mode)::text = 'relevance' THEN page.score END DESC,
    CASE WHEN sqlc.arg(sort_mode)::text = 'date_asc' THEN page.txn_date END ASC,
    CASE WHEN sqlc.arg(sort_mode)::text = 'date_asc' THEN page.id END ASC,
    page.txn_date DESC, page.id DESC;
