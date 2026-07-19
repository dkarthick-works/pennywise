-- Credit card statement closing day (1..31, nullable). Drives the dashboard
-- "statement cycle" credit-usage window. NULL means the user has not configured
-- a cycle yet, so only the calendar-month view is available.
ALTER TABLE user_settings
  ADD COLUMN credit_statement_day SMALLINT NULL;

ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_credit_statement_day_chk
  CHECK (credit_statement_day IS NULL OR credit_statement_day BETWEEN 1 AND 31);
