package api

import (
	"context"
	"os"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEventsMigrationRoundTrip(t *testing.T) {
	rawURL := os.Getenv("PENNYWISE_TEST_DATABASE_URL")
	if rawURL == "" {
		t.Skip("set PENNYWISE_TEST_DATABASE_URL to run event migration test")
	}
	migrateTestDB(t, rawURL)
	m := newSuggestionTestMigrator(t, rawURL)
	defer func() {
		if err := m.Up(); err != nil && err != migrate.ErrNoChange {
			t.Errorf("restore latest migration: %v", err)
		}
		_, _ = m.Close()
	}()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, rawURL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = pool.Exec(ctx, "TRUNCATE users CASCADE"); pool.Close() }()
	if _, err := pool.Exec(ctx, "TRUNCATE users CASCADE"); err != nil {
		t.Fatal(err)
	}
	move := func(version uint) {
		t.Helper()
		if err := m.Migrate(version); err != nil && err != migrate.ErrNoChange {
			t.Fatalf("migrate to %d: %v", version, err)
		}
		got, dirty, err := m.Version()
		if err != nil || dirty || got != version {
			t.Fatalf("version=%d dirty=%v err=%v", got, dirty, err)
		}
	}
	checkTables := func(want int) {
		t.Helper()
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('events','event_items')`).Scan(&count); err != nil || count != want {
			t.Fatalf("event tables=%d want=%d err=%v", count, want, err)
		}
	}
	move(11)
	checkTables(0)
	uid, txnID := uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,email) VALUES($1,'event-migration@example.com')`, uid); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO transactions(id,user_id,section,category,amount,txn_date,kind) VALUES($1,$2,'daily','Migration sentinel',12.34,'2026-06-01','cash')`, txnID, uid); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO monthly_budgets(user_id,month,budget_essential,budget_flexible,budget_daily) VALUES($1,'2026-06-01',100,200,300)`, uid); err != nil {
		t.Fatal(err)
	}
	for cycle := 0; cycle < 2; cycle++ {
		move(12)
		checkTables(2)
		var eventID uuid.UUID
		var status string
		var enabled bool
		var version int64
		if err := pool.QueryRow(ctx, `INSERT INTO events(user_id,name) VALUES($1,'Service') RETURNING id,status,suggestions_enabled,version`, uid).Scan(&eventID, &status, &enabled, &version); err != nil {
			t.Fatal(err)
		}
		if status != "planned" || !enabled || version != 1 {
			t.Fatalf("defaults: %s %v %d", status, enabled, version)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO event_items(event_id,name,position,expected_cost,actual_cost) VALUES($1,'Bill',0,NULL,0)`, eventID); err != nil {
			t.Fatal(err)
		}
		for _, amount := range []string{"-1", "NaN", "1000000000000"} {
			if _, err := pool.Exec(ctx, `INSERT INTO event_items(event_id,name,position,expected_cost) VALUES($1,'Invalid',1,$2::numeric)`, eventID, amount); err == nil {
				t.Fatalf("database accepted %s", amount)
			}
		}
		if cycle == 0 {
			move(11)
			checkTables(0)
		}
	}
	var amount, essential, flexible, daily string
	if err := pool.QueryRow(ctx, `SELECT amount::text FROM transactions WHERE id=$1`, txnID).Scan(&amount); err != nil || amount != "12.34" {
		t.Fatalf("transaction changed: %s %v", amount, err)
	}
	if err := pool.QueryRow(ctx, `SELECT budget_essential::text,budget_flexible::text,budget_daily::text FROM monthly_budgets WHERE user_id=$1`, uid).Scan(&essential, &flexible, &daily); err != nil || essential != "100.00" || flexible != "200.00" || daily != "300.00" {
		t.Fatalf("budgets changed: %s/%s/%s %v", essential, flexible, daily, err)
	}
}
