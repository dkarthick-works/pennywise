-- New users start with zero income and budgets; they configure their own values.
ALTER TABLE user_settings ALTER COLUMN income           SET DEFAULT 0;
ALTER TABLE user_settings ALTER COLUMN budget_essential SET DEFAULT 0;
ALTER TABLE user_settings ALTER COLUMN budget_flexible  SET DEFAULT 0;
ALTER TABLE user_settings ALTER COLUMN budget_daily     SET DEFAULT 0;
