ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_credit_statement_day_chk;

ALTER TABLE user_settings
  DROP COLUMN IF EXISTS credit_statement_day;
