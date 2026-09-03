-- name: GetMonthlyBudget :one
SELECT * FROM monthly_budgets
WHERE user_id = sqlc.arg(user_id)
  AND month = sqlc.arg(month);

-- name: ListMonthlyBudgets :many
SELECT * FROM monthly_budgets
WHERE user_id = sqlc.arg(user_id)
ORDER BY month DESC;

-- name: UpsertMonthlyBudget :one
INSERT INTO monthly_budgets (
    user_id,
    month,
    budget_essential,
    budget_flexible,
    budget_daily
) VALUES (
    sqlc.arg(user_id),
    sqlc.arg(month),
    sqlc.arg(budget_essential),
    sqlc.arg(budget_flexible),
    sqlc.arg(budget_daily)
)
ON CONFLICT (user_id, month) DO UPDATE
SET budget_essential = EXCLUDED.budget_essential,
    budget_flexible  = EXCLUDED.budget_flexible,
    budget_daily     = EXCLUDED.budget_daily,
    updated_at       = now()
RETURNING *;
