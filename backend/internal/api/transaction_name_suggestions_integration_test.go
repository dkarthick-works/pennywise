package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	dbfs "github.com/ledger/backend/db"
)

type suggestionRecord struct {
	DisplayName    string
	NormalizedName string
	UseCount       int64
	LastUsedAt     time.Time
}

func TestTransactionNameSuggestionTriggerLifecycle(t *testing.T) {
	_, pool, _, userID := setupCategoryAPITest(t)
	defer pool.Close()
	ctx := context.Background()

	assertAutocompleteSchema(t, pool)

	coffeeID := insertTransactionForSuggestionTest(t, pool, userID, "daily", "  Coffee   Shop ", "cash")
	got := loadSuggestionRecord(t, pool, userID, "daily", "coffee shop")
	if got.DisplayName != "Coffee Shop" || got.UseCount != 1 {
		t.Fatalf("first suggestion = %#v, want display Coffee Shop count 1", got)
	}

	insertTransactionForSuggestionTest(t, pool, userID, "daily", "coffee shop", "cash")
	got = loadSuggestionRecord(t, pool, userID, "daily", "coffee shop")
	if got.DisplayName != "coffee shop" || got.UseCount != 2 {
		t.Fatalf("reused suggestion = %#v, want latest display and count 2", got)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE transactions
		SET amount = 42, kind = 'credit', updated_at = now()
		WHERE id = $1
	`, coffeeID); err != nil {
		t.Fatalf("update unrelated fields: %v", err)
	}
	if got := loadSuggestionRecord(t, pool, userID, "daily", "coffee shop"); got.UseCount != 2 {
		t.Fatalf("count after unrelated update = %d, want 2", got.UseCount)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE transactions
		SET category = 'COFFEE   SHOP', updated_at = now()
		WHERE id = $1
	`, coffeeID); err != nil {
		t.Fatalf("update display spelling: %v", err)
	}
	got = loadSuggestionRecord(t, pool, userID, "daily", "coffee shop")
	if got.DisplayName != "COFFEE SHOP" || got.UseCount != 2 {
		t.Fatalf("case-only update = %#v, want refreshed display without increment", got)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE transactions
		SET category = 'Cafe', updated_at = now()
		WHERE id = $1
	`, coffeeID); err != nil {
		t.Fatalf("rename transaction: %v", err)
	}
	if got := loadSuggestionRecord(t, pool, userID, "daily", "cafe"); got.UseCount != 1 {
		t.Fatalf("renamed suggestion count = %d, want 1", got.UseCount)
	}
	if got := loadSuggestionRecord(t, pool, userID, "daily", "coffee shop"); got.UseCount != 2 {
		t.Fatalf("old history count = %d, want 2", got.UseCount)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE transactions
		SET section = 'flexible', updated_at = now()
		WHERE id = $1
	`, coffeeID); err != nil {
		t.Fatalf("move section: %v", err)
	}
	loadSuggestionRecord(t, pool, userID, "daily", "cafe")
	loadSuggestionRecord(t, pool, userID, "flexible", "cafe")

	if _, err := pool.Exec(ctx, `
		UPDATE transactions
		SET kind = 'settlement', updated_at = now()
		WHERE id = $1
	`, coffeeID); err != nil {
		t.Fatalf("change to settlement: %v", err)
	}
	loadSuggestionRecord(t, pool, userID, "flexible", "cafe")

	settlementID := insertTransactionForSuggestionTest(t, pool, userID, "daily", "Settles: Coffee", "settlement")
	assertSuggestionMissing(t, pool, userID, "daily", "settles: coffee")
	if _, err := pool.Exec(ctx, `
		UPDATE transactions SET kind = 'cash', updated_at = now() WHERE id = $1
	`, settlementID); err != nil {
		t.Fatalf("change settlement to normal: %v", err)
	}
	loadSuggestionRecord(t, pool, userID, "daily", "settles: coffee")

	insertTransactionForSuggestionTest(t, pool, userID, "daily", "   ", "cash")
	insertTransactionForSuggestionTest(t, pool, userID, "daily", strings.Repeat("x", 201), "cash")
	assertSuggestionMissing(t, pool, userID, "daily", "")
	assertSuggestionMissing(t, pool, userID, "daily", strings.Repeat("x", 201))

	if _, err := pool.Exec(ctx, `DELETE FROM transactions WHERE id = $1`, coffeeID); err != nil {
		t.Fatalf("delete transaction: %v", err)
	}
	loadSuggestionRecord(t, pool, userID, "flexible", "cafe")

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin rollback test: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO transactions (user_id, section, category, amount, txn_date, kind)
		VALUES ($1, 'daily', 'Rolled Back', 0, '2026-01-01', 'cash')
	`, userID); err != nil {
		t.Fatalf("insert rollback test: %v", err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	assertSuggestionMissing(t, pool, userID, "daily", "rolled back")

	insertTransactionForSuggestionTest(t, pool, userID, "daily", "Overflow", "cash")
	if _, err := pool.Exec(ctx, `
		UPDATE transaction_name_suggestions
		SET use_count = 9223372036854775807
		WHERE user_id = $1 AND section = 'daily' AND normalized_name = 'overflow'
	`, userID); err != nil {
		t.Fatalf("prime overflow failure: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO transactions (user_id, section, category, amount, txn_date, kind)
		VALUES ($1, 'daily', 'Overflow', 0, '2026-01-02', 'cash')
	`, userID); err == nil {
		t.Fatal("expected trigger overflow to reject originating transaction")
	}
	var overflowTransactions int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM transactions
		WHERE user_id = $1 AND section = 'daily' AND category = 'Overflow'
	`, userID).Scan(&overflowTransactions); err != nil {
		t.Fatalf("count overflow transactions: %v", err)
	}
	if overflowTransactions != 1 {
		t.Fatalf("overflow transactions = %d, want only original row", overflowTransactions)
	}

	otherUserID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (id, email) VALUES ($1, 'suggestion-cascade@example.com')
	`, otherUserID); err != nil {
		t.Fatalf("insert cascade user: %v", err)
	}
	insertTransactionForSuggestionTest(t, pool, otherUserID, "daily", "Private", "cash")
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, otherUserID); err != nil {
		t.Fatalf("delete cascade user: %v", err)
	}
	assertSuggestionMissing(t, pool, otherUserID, "daily", "private")
}

func TestTransactionNameSuggestionsAPI(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		insertTransactionForSuggestionTest(t, pool, userID, "daily", "Coffee", "cash")
	}
	for i := 0; i < 2; i++ {
		insertTransactionForSuggestionTest(t, pool, userID, "daily", "Coffeemate", "cash")
	}
	insertTransactionForSuggestionTest(t, pool, userID, "daily", "Iced Coffee", "cash")
	insertTransactionForSuggestionTest(t, pool, userID, "daily", "Netflix", "cash")
	insertTransactionForSuggestionTest(t, pool, userID, "flexible", "Coffee Flexible", "cash")

	otherUserID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (id, email) VALUES ($1, 'suggestion-private@example.com')
	`, otherUserID); err != nil {
		t.Fatalf("insert other user: %v", err)
	}
	insertTransactionForSuggestionTest(t, pool, otherUserID, "daily", "Coffee Private", "cash")

	assertSuggestionAPIError(t, srv, token, "/api/transaction-names/suggestions", http.StatusBadRequest, invalidTransactionNameSectionMessage)
	assertSuggestionAPIError(t, srv, token, "/api/transaction-names/suggestions?section=misc", http.StatusBadRequest, invalidTransactionNameSectionMessage)
	assertSuggestionAPIError(t, srv, token, "/api/transaction-names/suggestions?section=daily&limit=0", http.StatusBadRequest, invalidTransactionNameLimitMessage)
	assertSuggestionAPIError(t, srv, token, "/api/transaction-names/suggestions?section=daily&limit=21", http.StatusBadRequest, invalidTransactionNameLimitMessage)
	assertSuggestionAPIError(t, srv, token, "/api/transaction-names/suggestions?section=daily&limit=nope", http.StatusBadRequest, invalidTransactionNameLimitMessage)
	longQuery := url.QueryEscape(strings.Repeat("界", 101))
	assertSuggestionAPIError(t, srv, token, "/api/transaction-names/suggestions?section=daily&q="+longQuery, http.StatusBadRequest, invalidTransactionNameQueryMessage)

	popular := requestSuggestionNames(t, srv, token, "/api/transaction-names/suggestions?section=daily")
	if len(popular) == 0 || popular[0] != "Coffee" {
		t.Fatalf("popular suggestions = %#v, want Coffee first", popular)
	}
	for _, forbidden := range []string{"Coffee Flexible", "Coffee Private"} {
		if containsString(popular, forbidden) {
			t.Fatalf("popular suggestions leaked %q: %#v", forbidden, popular)
		}
	}

	short := requestSuggestionNames(t, srv, token, "/api/transaction-names/suggestions?section=daily&q=co")
	if len(short) < 2 || short[0] != "Coffee" || short[1] != "Coffeemate" || containsString(short, "Iced Coffee") {
		t.Fatalf("short prefix suggestions = %#v", short)
	}

	contains := requestSuggestionNames(t, srv, token, "/api/transaction-names/suggestions?section=daily&q=coffee")
	if len(contains) < 3 || contains[0] != "Coffee" || contains[1] != "Coffeemate" || contains[2] != "Iced Coffee" {
		t.Fatalf("ranked suggestions = %#v", contains)
	}

	fuzzy := requestSuggestionNames(t, srv, token, "/api/transaction-names/suggestions?section=daily&q=netfliz")
	if !containsString(fuzzy, "Netflix") {
		t.Fatalf("fuzzy suggestions = %#v, want Netflix", fuzzy)
	}

	limited := requestSuggestionNames(t, srv, token, "/api/transaction-names/suggestions?section=daily&limit=1")
	if len(limited) != 1 {
		t.Fatalf("limited suggestions length = %d, want 1", len(limited))
	}
	empty := requestSuggestionNames(t, srv, token, "/api/transaction-names/suggestions?section=income&q=missing")
	if empty == nil || len(empty) != 0 {
		t.Fatalf("empty suggestions = %#v, want allocated empty list", empty)
	}

	legacy := apiRequest(t, srv, token, http.MethodGet, "/api/daily-suggestions", nil)
	if legacy.Code != http.StatusOK {
		t.Fatalf("legacy endpoint status = %d body = %s", legacy.Code, legacy.Body.String())
	}
	var legacyNames []string
	if err := json.Unmarshal(legacy.Body.Bytes(), &legacyNames); err != nil {
		t.Fatalf("decode legacy response: %v", err)
	}
	if !containsString(legacyNames, "Coffee") {
		t.Fatalf("legacy suggestions = %#v, want Coffee", legacyNames)
	}

	unauthorized := httptest.NewRecorder()
	srv.Router().ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/transaction-names/suggestions?section=daily", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}

	t.Run("database failure is generic", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `
			ALTER TABLE transaction_name_suggestions RENAME TO transaction_name_suggestions_unavailable
		`); err != nil {
			t.Fatalf("rename suggestion table: %v", err)
		}
		defer func() {
			if _, err := pool.Exec(ctx, `
				ALTER TABLE transaction_name_suggestions_unavailable RENAME TO transaction_name_suggestions
			`); err != nil {
				t.Errorf("restore suggestion table: %v", err)
			}
		}()

		assertSuggestionAPIError(t, srv, token, "/api/transaction-names/suggestions?section=daily", http.StatusInternalServerError, loadTransactionNameSuggestionsMessage)
	})
}

func TestTransactionNameSuggestionsBackfill(t *testing.T) {
	rawURL := os.Getenv("PENNYWISE_TEST_DATABASE_URL")
	if rawURL == "" {
		t.Skip("set PENNYWISE_TEST_DATABASE_URL to run autocomplete backfill integration test")
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
		t.Fatalf("migrate down to version 6: %v", err)
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
		t.Fatalf("clean backfill database: %v", err)
	}

	userA, userB := uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (id, email) VALUES
			($1, 'backfill-a@example.com'),
			($2, 'backfill-b@example.com')
	`, userA, userB); err != nil {
		t.Fatalf("insert backfill users: %v", err)
	}

	older := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	newer := older.Add(24 * time.Hour)
	if _, err := pool.Exec(ctx, `
		INSERT INTO transactions (id, user_id, section, category, amount, txn_date, kind, updated_at) VALUES
			($1, $2, 'daily', ' Coffee   Shop ', 0, '2026-01-01', 'cash', $3),
			($4, $2, 'daily', 'COFFEE SHOP', 10, '2026-01-02', 'credit', $5),
			($6, $2, 'flexible', 'Coffee Shop', 10, '2026-01-02', 'cash', $5),
			($7, $8, 'daily', 'Coffee Shop', 10, '2026-01-02', 'cash', $5),
			($9, $2, 'daily', '   ', 0, '2026-01-03', 'cash', $5),
			($10, $2, 'daily', 'Settles: Coffee', 10, '2026-01-03', 'settlement', $5),
			($11, $2, 'daily', $12, 10, '2026-01-03', 'cash', $5)
	`,
		uuid.New(), userA, older,
		uuid.New(), newer,
		uuid.New(),
		uuid.New(), userB,
		uuid.New(),
		uuid.New(),
		uuid.New(), strings.Repeat("x", 201),
	); err != nil {
		t.Fatalf("insert backfill transactions: %v", err)
	}

	if err := m.Steps(1); err != nil {
		t.Fatalf("apply autocomplete migration: %v", err)
	}
	restored = true

	got := loadSuggestionRecord(t, pool, userA, "daily", "coffee shop")
	if got.DisplayName != "COFFEE SHOP" || got.UseCount != 2 || !got.LastUsedAt.Equal(newer) {
		t.Fatalf("backfilled daily suggestion = %#v", got)
	}
	if got := loadSuggestionRecord(t, pool, userA, "flexible", "coffee shop"); got.UseCount != 1 {
		t.Fatalf("backfilled section count = %d, want 1", got.UseCount)
	}
	if got := loadSuggestionRecord(t, pool, userB, "daily", "coffee shop"); got.UseCount != 1 {
		t.Fatalf("backfilled user isolation count = %d, want 1", got.UseCount)
	}
	assertSuggestionMissing(t, pool, userA, "daily", "settles: coffee")
	assertSuggestionMissing(t, pool, userA, "daily", strings.Repeat("x", 201))
}

func newSuggestionTestMigrator(t *testing.T, rawURL string) *migrate.Migrate {
	t.Helper()
	src, err := iofs.New(dbfs.Migrations, "migrations")
	if err != nil {
		t.Fatalf("migration source: %v", err)
	}
	dsn := rawURL
	for _, prefix := range []string{"postgresql://", "postgres://"} {
		if rest, ok := strings.CutPrefix(dsn, prefix); ok {
			dsn = "pgx5://" + rest
			break
		}
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, dsn)
	if err != nil {
		t.Fatalf("new migrator: %v", err)
	}
	return m
}

func assertAutocompleteSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	var extensionExists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')`).Scan(&extensionExists); err != nil {
		t.Fatalf("check pg_trgm: %v", err)
	}
	if !extensionExists {
		t.Fatal("pg_trgm extension is missing")
	}

	var indexCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM pg_indexes
		WHERE schemaname = current_schema()
		  AND indexname IN (
			'transaction_name_suggestions_trgm_idx',
			'transaction_name_suggestions_prefix_idx',
			'transaction_name_suggestions_ranking_idx'
		  )
	`).Scan(&indexCount); err != nil {
		t.Fatalf("check autocomplete indexes: %v", err)
	}
	if indexCount != 3 {
		t.Fatalf("autocomplete index count = %d, want 3", indexCount)
	}

	var triggerCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM pg_trigger
		WHERE tgrelid = 'transactions'::regclass
		  AND NOT tgisinternal
		  AND tgname IN ('transactions_learn_name_after_insert', 'transactions_learn_name_after_update')
	`).Scan(&triggerCount); err != nil {
		t.Fatalf("check autocomplete triggers: %v", err)
	}
	if triggerCount != 2 {
		t.Fatalf("autocomplete trigger count = %d, want 2", triggerCount)
	}
}

func insertTransactionForSuggestionTest(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, section, category, kind string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO transactions (user_id, section, category, amount, txn_date, kind)
		VALUES ($1, $2::section, $3, 0, '2026-01-01', $4::txn_kind)
		RETURNING id
	`, userID, section, category, kind).Scan(&id); err != nil {
		t.Fatalf("insert transaction %q: %v", category, err)
	}
	return id
}

func loadSuggestionRecord(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, section, normalizedName string) suggestionRecord {
	t.Helper()
	var got suggestionRecord
	if err := pool.QueryRow(context.Background(), `
		SELECT display_name, normalized_name, use_count, last_used_at
		FROM transaction_name_suggestions
		WHERE user_id = $1 AND section = $2::section AND normalized_name = $3
	`, userID, section, normalizedName).Scan(&got.DisplayName, &got.NormalizedName, &got.UseCount, &got.LastUsedAt); err != nil {
		t.Fatalf("load suggestion %q/%q: %v", section, normalizedName, err)
	}
	return got
}

func assertSuggestionMissing(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, section, normalizedName string) {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1 FROM transaction_name_suggestions
			WHERE user_id = $1 AND section = $2::section AND normalized_name = $3
		)
	`, userID, section, normalizedName).Scan(&exists); err != nil {
		t.Fatalf("check missing suggestion %q/%q: %v", section, normalizedName, err)
	}
	if exists {
		t.Fatalf("suggestion %q/%q unexpectedly exists", section, normalizedName)
	}
}

func requestSuggestionNames(t *testing.T, srv *Server, token, path string) []string {
	t.Helper()
	rr := apiRequest(t, srv, token, http.MethodGet, path, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("suggestion status = %d body = %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	var body transactionNameSuggestionsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode suggestions: %v", err)
	}
	names := make([]string, 0, len(body.Items))
	for _, item := range body.Items {
		names = append(names, item.Name)
	}
	return names
}

func assertSuggestionAPIError(t *testing.T, srv *Server, token, path string, wantStatus int, wantMessage string) {
	t.Helper()
	rr := apiRequest(t, srv, token, http.MethodGet, path, nil)
	if rr.Code != wantStatus {
		t.Fatalf("status = %d body = %s, want %d", rr.Code, rr.Body.String(), wantStatus)
	}
	if got := rr.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if body.Error != wantMessage {
		t.Fatalf("error = %q, want %q", body.Error, wantMessage)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
