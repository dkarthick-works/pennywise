DROP TRIGGER IF EXISTS transactions_learn_name_after_update ON transactions;
DROP TRIGGER IF EXISTS transactions_learn_name_after_insert ON transactions;
DROP FUNCTION IF EXISTS learn_transaction_name_suggestion();
DROP TABLE IF EXISTS transaction_name_suggestions;

-- pg_trgm is intentionally retained because other database features may share it.
