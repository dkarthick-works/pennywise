package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestOpenMonthOrdersByUpdatedAtDesc(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	markMonthSeeded(t, pool, userID, "2026-06")

	older := insertTxnAt(t, pool, userID, "essential", "Rent", 1000, "2026-06-01", "cash",
		time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC),
		time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC),
	)
	newer := insertTxnAt(t, pool, userID, "essential", "Utilities", 500, "2026-06-02", "cash",
		time.Date(2026, 6, 2, 10, 0, 0, 0, time.UTC),
		time.Date(2026, 6, 3, 12, 0, 0, 0, time.UTC),
	)

	rr := apiRequest(t, srv, token, http.MethodPost, "/api/months/2026-06/open", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("open month status = %d body = %s", rr.Code, rr.Body.String())
	}
	ids := openMonthTxnIDs(t, rr.Body.Bytes())
	if len(ids) < 2 {
		t.Fatalf("got %d txns, want at least 2", len(ids))
	}
	if ids[0] != newer.String() || ids[1] != older.String() {
		t.Fatalf("open-month order = %v, want [%s %s]", ids[:2], newer, older)
	}
}

func TestOpenMonthEqualUpdatedAtUsesTxnDateThenID(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	markMonthSeeded(t, pool, userID, "2026-06")

	ts := time.Date(2026, 6, 5, 15, 0, 0, 0, time.UTC)
	// Lower UUID string sorts first; Recent order is id DESC so higher id wins on ties.
	idEarlyDate := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	idLateDateLow := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	idLateDateHigh := uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc")

	insertTxnWithID(t, pool, idEarlyDate, userID, "essential", "A", 1, "2026-06-01", "cash", ts, ts)
	insertTxnWithID(t, pool, idLateDateLow, userID, "essential", "B", 1, "2026-06-10", "cash", ts, ts)
	insertTxnWithID(t, pool, idLateDateHigh, userID, "essential", "C", 1, "2026-06-10", "cash", ts, ts)

	rr := apiRequest(t, srv, token, http.MethodPost, "/api/months/2026-06/open", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("open month status = %d body = %s", rr.Code, rr.Body.String())
	}
	ids := openMonthTxnIDs(t, rr.Body.Bytes())
	want := []string{idLateDateHigh.String(), idLateDateLow.String(), idEarlyDate.String()}
	if len(ids) < 3 {
		t.Fatalf("got %d txns, want at least 3", len(ids))
	}
	got := ids[:3]
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("open-month order = %v, want %v", got, want)
		}
	}
}

func TestListTransactionsByMonthStaysChronological(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	first := insertTxnAt(t, pool, userID, "essential", "Rent", 1000, "2026-06-01", "cash",
		time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC),
		time.Date(2026, 6, 10, 8, 0, 0, 0, time.UTC), // newer updated_at
	)
	second := insertTxnAt(t, pool, userID, "essential", "Utilities", 500, "2026-06-05", "cash",
		time.Date(2026, 6, 5, 8, 0, 0, 0, time.UTC),
		time.Date(2026, 6, 5, 8, 0, 0, 0, time.UTC),
	)

	rr := apiRequest(t, srv, token, http.MethodGet, "/api/transactions?month=2026-06", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d body = %s", rr.Code, rr.Body.String())
	}
	var txns []TransactionDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &txns); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(txns) < 2 {
		t.Fatalf("got %d txns, want at least 2", len(txns))
	}
	if txns[0].ID != first.String() || txns[1].ID != second.String() {
		t.Fatalf("list order = [%s %s], want chronological [%s %s]",
			txns[0].ID, txns[1].ID, first, second)
	}
}

func TestUpdateTransactionNoOpPreservesUpdatedAt(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	fixed := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	id := insertTxnAt(t, pool, userID, "essential", "Rent", 1000, "2026-06-01", "cash", fixed, fixed)

	rr := apiRequest(t, srv, token, http.MethodPatch, "/api/transactions/"+id.String(), map[string]any{
		"kind":    "cash",
		"settles": []string{},
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("patch status = %d body = %s", rr.Code, rr.Body.String())
	}

	var updatedAt time.Time
	err := pool.QueryRow(context.Background(),
		`SELECT updated_at FROM transactions WHERE id = $1`, id,
	).Scan(&updatedAt)
	if err != nil {
		t.Fatalf("read updated_at: %v", err)
	}
	if !updatedAt.Equal(fixed) {
		t.Fatalf("updated_at = %v, want unchanged %v", updatedAt, fixed)
	}
}

func markMonthSeeded(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, month string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO month_state (user_id, month, closed, seeded)
		VALUES ($1, $2, false, true)
	`, userID, month)
	if err != nil {
		t.Fatalf("mark month seeded: %v", err)
	}
}

func openMonthTxnIDs(t *testing.T, body []byte) []string {
	t.Helper()
	var payload struct {
		Transactions []TransactionDTO `json:"transactions"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode open-month: %v", err)
	}
	ids := make([]string, len(payload.Transactions))
	for i, txn := range payload.Transactions {
		ids[i] = txn.ID
	}
	return ids
}

func insertTxnAt(
	t *testing.T, pool *pgxpool.Pool, userID uuid.UUID,
	section, category string, amount float64, date, kind string,
	createdAt, updatedAt time.Time,
) uuid.UUID {
	t.Helper()
	id := uuid.New()
	insertTxnWithID(t, pool, id, userID, section, category, amount, date, kind, createdAt, updatedAt)
	return id
}

func insertTxnWithID(
	t *testing.T, pool *pgxpool.Pool, id, userID uuid.UUID,
	section, category string, amount float64, date, kind string,
	createdAt, updatedAt time.Time,
) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO transactions (id, user_id, section, category, amount, txn_date, kind, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)
	`, id, userID, section, category, amount, date, kind, createdAt, updatedAt)
	if err != nil {
		t.Fatalf("insert txn: %v", err)
	}
}
