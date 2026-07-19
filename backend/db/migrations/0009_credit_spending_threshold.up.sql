-- Optional per-period credit spending threshold (rupees, two decimals). Drives
-- the dashboard "period spending threshold" marker on the credit-usage card.
-- NULL means the feature is disabled; only strictly positive values are stored.
ALTER TABLE user_settings
  ADD COLUMN credit_spending_threshold NUMERIC(14,2) NULL;

ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_credit_spending_threshold_chk
  CHECK (credit_spending_threshold IS NULL OR credit_spending_threshold > 0);
