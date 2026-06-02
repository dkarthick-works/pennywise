-- Income is now tracked as transactions (section = 'income') rather than a
-- static setting. This migration adds the enum value and removes the column.

ALTER TYPE section ADD VALUE IF NOT EXISTS 'income';

ALTER TABLE user_settings DROP COLUMN IF EXISTS income;
