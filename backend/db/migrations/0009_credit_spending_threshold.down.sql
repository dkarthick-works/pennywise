ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_credit_spending_threshold_chk;

ALTER TABLE user_settings
  DROP COLUMN IF EXISTS credit_spending_threshold;
