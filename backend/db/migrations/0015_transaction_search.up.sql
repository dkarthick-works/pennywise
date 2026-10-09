-- Shared normalization keeps indexed names and query text identical.
CREATE FUNCTION normalize_transaction_search(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT lower(btrim(regexp_replace(value, '[[:space:]]+', ' ', 'g'))) $$;

ALTER TABLE transactions ADD COLUMN normalized_name text
GENERATED ALWAYS AS (normalize_transaction_search(category)) STORED;

CREATE INDEX transactions_search_trgm_idx ON transactions
USING GIN (normalized_name gin_trgm_ops);
CREATE INDEX transactions_search_prefix_idx ON transactions
(user_id, normalized_name text_pattern_ops);
