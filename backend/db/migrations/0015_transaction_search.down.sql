DROP INDEX transactions_search_prefix_idx;
DROP INDEX transactions_search_trgm_idx;
ALTER TABLE transactions DROP COLUMN normalized_name;
DROP FUNCTION normalize_transaction_search(text);
