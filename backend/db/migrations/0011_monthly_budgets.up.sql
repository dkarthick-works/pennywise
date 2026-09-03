CREATE TABLE monthly_budgets (
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month            DATE NOT NULL,
    budget_essential NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (budget_essential >= 0),
    budget_flexible  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (budget_flexible >= 0),
    budget_daily     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (budget_daily >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, month),
    CONSTRAINT monthly_budgets_month_start_chk
        CHECK (month = date_trunc('month', month)::date)
);

-- Copy each user's last global budget into every calendar month that already
-- has a transaction. Users with no transactions get no rows (reads as zero).
INSERT INTO monthly_budgets (
    user_id,
    month,
    budget_essential,
    budget_flexible,
    budget_daily
)
SELECT
    us.user_id,
    transaction_months.month,
    us.budget_essential,
    us.budget_flexible,
    us.budget_daily
FROM user_settings AS us
JOIN (
    SELECT DISTINCT
        user_id,
        date_trunc('month', txn_date)::date AS month
    FROM transactions
) AS transaction_months
    ON transaction_months.user_id = us.user_id;

ALTER TABLE user_settings
    DROP COLUMN budget_essential,
    DROP COLUMN budget_flexible,
    DROP COLUMN budget_daily;
