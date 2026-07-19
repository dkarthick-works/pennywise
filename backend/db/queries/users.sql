-- name: UpsertUser :one
-- Mirror a Goauth subject into our users table on first sight (and keep email fresh).
INSERT INTO users (id, email)
VALUES ($1, $2)
ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = now()
RETURNING *;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: UpdateUserProfile :one
UPDATE users
SET display_name = $2,
    email        = $3,
    updated_at   = now()
WHERE id = $1
RETURNING *;

-- name: EnsureSettings :one
-- Create the default settings row for a user if it does not exist yet.
INSERT INTO user_settings (user_id)
VALUES ($1)
ON CONFLICT (user_id) DO NOTHING
RETURNING *;

-- name: GetSettings :one
SELECT * FROM user_settings WHERE user_id = $1;

-- name: UpdateBudgets :one
UPDATE user_settings
SET budget_essential = $2,
    budget_flexible  = $3,
    budget_daily     = $4,
    updated_at       = now()
WHERE user_id = $1
RETURNING *;

-- name: UpdatePreferences :one
UPDATE user_settings
SET currency   = $2,
    theme      = $3,
    updated_at = now()
WHERE user_id = $1
RETURNING *;

-- name: UpdateCreditStatementDay :one
-- Set or clear (NULL) the credit card statement closing day. Dedicated so a
-- currency/theme update never touches this field and vice versa.
UPDATE user_settings
SET credit_statement_day = sqlc.narg(credit_statement_day),
    updated_at           = now()
WHERE user_id = sqlc.arg(user_id)
RETURNING *;
