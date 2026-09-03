package api

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMonthlyBudgetsMigrationBackfill(t *testing.T) {
	rawURL := os.Getenv("PENNYWISE_TEST_DATABASE_URL")
	if rawURL == "" {
		t.Skip("set PENNYWISE_TEST_DATABASE_URL to run monthly budget migration test")
	}

	migrateTestDB(t, rawURL)
	m := newSuggestionTestMigrator(t, rawURL)
	restored := false
	defer func() {
		if !restored {
			if err := m.Up(); err != nil && err != migrate.ErrNoChange {
				t.Errorf("restore latest migration: %v", err)
			}
		}
		_, _ = m.Close()
	}()

	if err := m.Steps(-1); err != nil {
		t.Fatalf("migrate down to version 10: %v", err)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, rawURL)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `TRUNCATE users CASCADE`)
		pool.Close()
	}()
	if _, err := pool.Exec(ctx, `TRUNCATE users CASCADE`); err != nil {
		t.Fatalf("clean database: %v", err)
	}

	withTxns, noTxns := uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (id, email) VALUES
			($1, 'budget-backfill-a@example.com'),
			($2, 'budget-backfill-b@example.com')
	`, withTxns, noTxns); err != nil {
		t.Fatalf("insert users: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_settings (user_id, budget_essential, budget_flexible, budget_daily)
		VALUES
			($1, 10000.25, 5000.50, 15000.75),
			($2, 1, 2, 3)
	`, withTxns, noTxns); err != nil {
		t.Fatalf("insert settings: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO transactions (user_id, section, category, amount, txn_date, kind) VALUES
			($1, 'daily', 'Coffee', 10, '2026-06-03', 'cash'),
			($1, 'essential', 'Rent', 20, '2026-07-01', 'cash')
	`, withTxns); err != nil {
		t.Fatalf("insert transactions: %v", err)
	}

	if err := m.Steps(1); err != nil {
		t.Fatalf("apply monthly budgets migration: %v", err)
	}

	var rowCount int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM monthly_budgets WHERE user_id = $1
	`, withTxns).Scan(&rowCount); err != nil {
		t.Fatalf("count monthly rows: %v", err)
	}
	if rowCount != 2 {
		t.Fatalf("monthly rows = %d, want 2", rowCount)
	}

	var emptyCount int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM monthly_budgets WHERE user_id = $1
	`, noTxns).Scan(&emptyCount); err != nil {
		t.Fatalf("count empty-user rows: %v", err)
	}
	if emptyCount != 0 {
		t.Fatalf("empty-user monthly rows = %d, want 0", emptyCount)
	}

	rows, err := pool.Query(ctx, `
		SELECT month, budget_essential, budget_flexible, budget_daily
		FROM monthly_budgets
		WHERE user_id = $1
		ORDER BY month
	`, withTxns)
	if err != nil {
		t.Fatalf("list monthly rows: %v", err)
	}
	defer rows.Close()
	var months []string
	for rows.Next() {
		var month time.Time
		var essential, flexible, daily float64
		if err := rows.Scan(&month, &essential, &flexible, &daily); err != nil {
			t.Fatalf("scan monthly row: %v", err)
		}
		if essential != 10000.25 || flexible != 5000.50 || daily != 15000.75 {
			t.Fatalf("copied budget = %v/%v/%v, want 10000.25/5000.50/15000.75", essential, flexible, daily)
		}
		months = append(months, month.Format("2006-01-02"))
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate monthly rows: %v", err)
	}
	if len(months) != 2 || months[0] != "2026-06-01" || months[1] != "2026-07-01" {
		t.Fatalf("months = %#v, want 2026-06-01 and 2026-07-01", months)
	}

	var legacyCols int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_name = 'user_settings'
		  AND column_name IN ('budget_essential', 'budget_flexible', 'budget_daily')
	`).Scan(&legacyCols); err != nil {
		t.Fatalf("check dropped columns: %v", err)
	}
	if legacyCols != 0 {
		t.Fatalf("legacy budget columns still present: %d", legacyCols)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE monthly_budgets
		SET budget_essential = 999, budget_flexible = 888, budget_daily = 777
		WHERE user_id = $1 AND month = '2026-07-01'
	`, withTxns); err != nil {
		t.Fatalf("distinguish newest month: %v", err)
	}

	if err := m.Steps(-1); err != nil {
		t.Fatalf("migrate down: %v", err)
	}

	var essential, flexible, daily float64
	if err := pool.QueryRow(ctx, `
		SELECT budget_essential, budget_flexible, budget_daily
		FROM user_settings
		WHERE user_id = $1
	`, withTxns).Scan(&essential, &flexible, &daily); err != nil {
		t.Fatalf("read restored global budget: %v", err)
	}
	if essential != 999 || flexible != 888 || daily != 777 {
		t.Fatalf("restored global = %v/%v/%v, want newest monthly 999/888/777", essential, flexible, daily)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("restore latest migration: %v", err)
	}
	restored = true
}
