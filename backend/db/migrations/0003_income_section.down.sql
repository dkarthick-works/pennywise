ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS income NUMERIC(14,2) NOT NULL DEFAULT 0;
-- Note: Postgres does not support removing enum values; a full type recreation
-- would be needed to reverse the 'income' addition, which is not worth the
-- complexity. Leave the enum value in place on rollback.
