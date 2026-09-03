ALTER TABLE user_settings
    ADD COLUMN budget_essential NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN budget_flexible  NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN budget_daily     NUMERIC(14,2) NOT NULL DEFAULT 0;

UPDATE user_settings AS us
SET
    budget_essential = latest.budget_essential,
    budget_flexible  = latest.budget_flexible,
    budget_daily     = latest.budget_daily
FROM (
    SELECT DISTINCT ON (user_id)
        user_id,
        budget_essential,
        budget_flexible,
        budget_daily
    FROM monthly_budgets
    ORDER BY user_id, month DESC
) AS latest
WHERE us.user_id = latest.user_id;

DROP TABLE monthly_budgets;
