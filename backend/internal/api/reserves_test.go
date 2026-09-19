package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/auth"
)

func TestExistingUserGetsGeneralReserveOnAuthenticatedRequest(t *testing.T) {
	srv, pool, _, _ := setupCategoryAPITest(t)
	defer pool.Close()

	userID := uuid.New()
	if _, err := pool.Exec(context.Background(), `INSERT INTO users (id, email) VALUES ($1, $2)`, userID, "existing@example.com"); err != nil {
		t.Fatalf("insert existing user: %v", err)
	}
	var before int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM reserves WHERE user_id = $1`, userID).Scan(&before); err != nil {
		t.Fatalf("count reserves before request: %v", err)
	}
	if before != 0 {
		t.Fatalf("reserves before authenticated request = %d, want 0", before)
	}

	rr := apiRequest(t, srv, signedTestToken(t, userID), http.MethodGet, "/api/me", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("authenticated request status = %d body = %s", rr.Code, rr.Body.String())
	}
	reserves := listTestReserves(t, srv, signedTestToken(t, userID), false)
	if len(reserves) != 1 || !reserves[0].IsGeneral {
		t.Fatalf("reserves after authenticated request = %#v, want one General Reserve", reserves)
	}
}

func TestProvisionUserEnsuresExactlyOneGeneralReserve(t *testing.T) {
	srv, pool, _, _ := setupCategoryAPITest(t)
	defer pool.Close()

	userID := uuid.New()
	identity := auth.Identity{UserID: userID, Email: "reserve-owner@example.com"}

	const requests = 8
	start := make(chan struct{})
	errs := make(chan error, requests)
	var wg sync.WaitGroup
	for range requests {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errs <- srv.provisionUser(context.Background(), identity)
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent provision: %v", err)
		}
	}

	var count int
	var name string
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*), COALESCE(MIN(name), '')
		FROM reserves
		WHERE user_id = $1 AND is_general`, userID).Scan(&count, &name); err != nil {
		t.Fatalf("load general reserve: %v", err)
	}
	if count != 1 || name != "General Reserve" {
		t.Fatalf("general reserves = %d named %q, want exactly one General Reserve", count, name)
	}
}

type reserveTestDTO struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	IsGeneral bool    `json:"is_general"`
	Archived  bool    `json:"archived"`
	Balance   float64 `json:"balance"`
}

func TestReserveManagementLifecycleAndLimits(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	reserves := listTestReserves(t, srv, token, false)
	if len(reserves) != 1 || !reserves[0].IsGeneral || reserves[0].Name != "General Reserve" || reserves[0].Balance != 0 {
		t.Fatalf("initial reserves = %#v, want one zero-balance General Reserve", reserves)
	}

	generalID := reserves[0].ID
	rr := apiRequest(t, srv, token, http.MethodPatch, "/api/reserves/"+generalID, map[string]any{"name": "  Rainy Day  "})
	if rr.Code != http.StatusOK {
		t.Fatalf("rename general status = %d body = %s", rr.Code, rr.Body.String())
	}
	var renamed reserveTestDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &renamed); err != nil {
		t.Fatalf("decode renamed reserve: %v", err)
	}
	if renamed.Name != "Rainy Day" || !renamed.IsGeneral {
		t.Fatalf("renamed general = %#v", renamed)
	}

	for _, name := range []string{"Ceremony", "Loan", "Car", "Holiday"} {
		rr = apiRequest(t, srv, token, http.MethodPost, "/api/reserves", map[string]any{"name": "  " + name + "  "})
		if rr.Code != http.StatusCreated {
			t.Fatalf("create %s status = %d body = %s", name, rr.Code, rr.Body.String())
		}
	}

	rr = apiRequest(t, srv, token, http.MethodPost, "/api/reserves", map[string]any{"name": "Sixth"})
	assertReserveError(t, rr, http.StatusConflict, "a maximum of 5 active reserves is allowed")

	rr = apiRequest(t, srv, token, http.MethodPost, "/api/reserves", map[string]any{"name": "ceremony"})
	assertReserveError(t, rr, http.StatusConflict, "reserve name already exists")

	// Balances come from signed ledger entries, not a mutable reserve column.
	var ceremonyID string
	if err := pool.QueryRow(context.Background(), `SELECT id FROM reserves WHERE user_id = $1 AND name = 'Ceremony'`, userID).Scan(&ceremonyID); err != nil {
		t.Fatalf("find Ceremony reserve: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		WITH op AS (
			INSERT INTO reserve_operations (user_id, operation_type, occurred_on, description)
			VALUES ($1, 'deposit', '2026-09-18', 'Opening allocation') RETURNING id
		)
		INSERT INTO reserve_entries (operation_id, reserve_id, direction, amount)
		SELECT id, $2, 'deposit', 1250.50 FROM op`, userID, ceremonyID); err != nil {
		t.Fatalf("insert reserve entry: %v", err)
	}
	reserves = listTestReserves(t, srv, token, false)
	var aggregate float64
	for _, reserve := range reserves {
		aggregate += reserve.Balance
		if reserve.ID == ceremonyID && reserve.Balance != 1250.5 {
			t.Fatalf("Ceremony balance = %v, want 1250.5", reserve.Balance)
		}
	}
	if aggregate != 1250.5 {
		t.Fatalf("aggregate balance = %v, want 1250.5", aggregate)
	}

}

func TestReserveOwnershipUsesNotFoundResponse(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	created := apiRequest(t, srv, token, http.MethodPost, "/api/reserves", map[string]any{"name": "Private"})
	if created.Code != http.StatusCreated {
		t.Fatalf("create reserve status = %d body = %s", created.Code, created.Body.String())
	}
	var reserve reserveTestDTO
	if err := json.Unmarshal(created.Body.Bytes(), &reserve); err != nil {
		t.Fatalf("decode reserve: %v", err)
	}

	otherID := uuid.New()
	if err := srv.provisionUser(context.Background(), auth.Identity{UserID: otherID, Email: "other-reserve@example.com"}); err != nil {
		t.Fatalf("provision other user: %v", err)
	}
	otherToken := signedTestToken(t, otherID)
	assertReserveError(t, apiRequest(t, srv, otherToken, http.MethodPatch, "/api/reserves/"+reserve.ID, map[string]any{"name": "Stolen"}), http.StatusNotFound, "reserve not found")
}

func TestSplitReserveDepositCreatesOneIsolatedOperation(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	general := listTestReserves(t, srv, token, false)[0]
	ceremony := createTestReserve(t, srv, token, "Ceremony Reserve")
	loan := createTestReserve(t, srv, token, "Loan Reserve")
	insertTxn(t, pool, userID, "income", "Salary", 85000, "2026-09-01", "cash")
	analyticsPaths := []string{
		"/api/dashboard/monthly?month=2026-09",
		"/api/dashboard/credit-usage?month=2026-09",
		"/api/budgets",
		"/api/categories/unmapped",
		"/api/insights",
		"/api/transactions?month=2026-09",
	}
	beforeAnalytics := make(map[string]string, len(analyticsPaths))
	for _, path := range analyticsPaths {
		beforeAnalytics[path] = apiRequest(t, srv, token, http.MethodGet, path, nil).Body.String()
	}

	rr := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
		"description": "  RSU vest  ",
		"date":        "2026-09-18",
		"note":        "September vest",
		"allocations": []map[string]any{
			{"reserve_id": ceremony.ID, "amount": 100000},
			{"reserve_id": loan.ID, "amount": 100000},
			{"reserve_id": general.ID, "amount": 60000},
		},
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create deposit status = %d body = %s", rr.Code, rr.Body.String())
	}
	var operation struct {
		ID          string  `json:"id"`
		Type        string  `json:"operation_type"`
		Description string  `json:"description"`
		Total       float64 `json:"total"`
		Entries     []struct {
			ReserveID string  `json:"reserve_id"`
			Amount    float64 `json:"amount"`
			Direction string  `json:"direction"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode operation: %v", err)
	}
	if operation.Type != "deposit" || operation.Description != "RSU vest" || operation.Total != 260000 || len(operation.Entries) != 3 {
		t.Fatalf("operation = %#v, want one 260000 split deposit", operation)
	}
	for _, entry := range operation.Entries {
		if entry.Direction != "deposit" {
			t.Fatalf("entry direction = %q, want deposit", entry.Direction)
		}
	}

	balances := map[string]float64{}
	var aggregate float64
	for _, reserve := range listTestReserves(t, srv, token, false) {
		balances[reserve.ID] = reserve.Balance
		aggregate += reserve.Balance
	}
	if balances[ceremony.ID] != 100000 || balances[loan.ID] != 100000 || balances[general.ID] != 60000 || aggregate != 260000 {
		t.Fatalf("balances = %#v aggregate = %v", balances, aggregate)
	}

	history := apiRequest(t, srv, token, http.MethodGet, "/api/reserve-operations?year=2026", nil)
	if history.Code != http.StatusOK {
		t.Fatalf("history status = %d body = %s", history.Code, history.Body.String())
	}
	var operations []json.RawMessage
	if err := json.Unmarshal(history.Body.Bytes(), &operations); err != nil || len(operations) != 1 {
		t.Fatalf("history = %s err = %v, want one operation", history.Body.String(), err)
	}

	for _, path := range analyticsPaths {
		after := apiRequest(t, srv, token, http.MethodGet, path, nil).Body.String()
		if after != beforeAnalytics[path] {
			t.Fatalf("reserve deposit changed %s. before=%s after=%s", path, beforeAnalytics[path], after)
		}
	}
	var transactionCount int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE user_id = $1`, userID).Scan(&transactionCount); err != nil {
		t.Fatalf("count transactions: %v", err)
	}
	if transactionCount != 1 {
		t.Fatalf("transactions = %d, want only pre-existing salary", transactionCount)
	}
}

func TestReserveDepositValidationIsAtomicAndOwnershipSafe(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	general := listTestReserves(t, srv, token, false)[0]
	second := createTestReserve(t, srv, token, "Second")

	otherID := uuid.New()
	if err := srv.provisionUser(context.Background(), auth.Identity{UserID: otherID, Email: "deposit-other@example.com"}); err != nil {
		t.Fatalf("provision other user: %v", err)
	}
	otherReserve := listTestReserves(t, srv, signedTestToken(t, otherID), false)[0]
	archived := createTestReserve(t, srv, token, "Archived")
	if _, err := pool.Exec(context.Background(), `UPDATE reserves SET archived_at = now() WHERE id = $1`, archived.ID); err != nil {
		t.Fatalf("archive reserve fixture: %v", err)
	}

	tests := []struct {
		name        string
		allocations any
		status      int
		message     string
	}{
		{name: "no allocations", allocations: []any{}, status: http.StatusBadRequest, message: "at least one allocation is required"},
		{name: "zero", allocations: []map[string]any{{"reserve_id": general.ID, "amount": 0}}, status: http.StatusBadRequest, message: "allocation amount must be greater than zero"},
		{name: "negative", allocations: []map[string]any{{"reserve_id": general.ID, "amount": -1}}, status: http.StatusBadRequest, message: "Amount must be zero or greater"},
		{name: "over precision", allocations: []map[string]any{{"reserve_id": general.ID, "amount": 1.001}}, status: http.StatusBadRequest, message: "Amount must have at most two decimal places"},
		{name: "overflow", allocations: []map[string]any{{"reserve_id": general.ID, "amount": 1000000000000}}, status: http.StatusBadRequest, message: "Amount exceeds the supported maximum"},
		{name: "duplicate reserve", allocations: []map[string]any{{"reserve_id": second.ID, "amount": 1}, {"reserve_id": second.ID, "amount": 2}}, status: http.StatusBadRequest, message: "each reserve may be allocated only once"},
		{name: "malformed id", allocations: []map[string]any{{"reserve_id": "bad", "amount": 1}}, status: http.StatusBadRequest, message: "allocation reserve_id must be a valid UUID"},
		{name: "other owner", allocations: []map[string]any{{"reserve_id": otherReserve.ID, "amount": 1}}, status: http.StatusNotFound, message: "reserve not found"},
		{name: "archived", allocations: []map[string]any{{"reserve_id": archived.ID, "amount": 1}}, status: http.StatusConflict, message: "archived reserves cannot receive allocations"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rr := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
				"description": "Deposit", "date": "2026-09-18", "allocations": tc.allocations,
			})
			assertReserveError(t, rr, tc.status, tc.message)
			var operations, entries int
			if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM reserve_operations`).Scan(&operations); err != nil {
				t.Fatalf("count operations: %v", err)
			}
			if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM reserve_entries`).Scan(&entries); err != nil {
				t.Fatalf("count entries: %v", err)
			}
			if operations != 0 || entries != 0 {
				t.Fatalf("rejected deposit persisted %d operations and %d entries", operations, entries)
			}
		})
	}
}

func TestReserveDepositHistoryIsReverseChronological(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	general := listTestReserves(t, srv, token, false)[0]
	for _, item := range []struct{ description, date string }{{"Older", "2026-01-01"}, {"Newer", "2026-12-31"}} {
		rr := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
			"description": item.description, "date": item.date,
			"allocations": []map[string]any{{"reserve_id": general.ID, "amount": 10.25}},
		})
		if rr.Code != http.StatusCreated {
			t.Fatalf("create %s status = %d body = %s", item.description, rr.Code, rr.Body.String())
		}
	}
	rr := apiRequest(t, srv, token, http.MethodGet, "/api/reserve-operations?year=2026", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("history status = %d body = %s", rr.Code, rr.Body.String())
	}
	var history []struct {
		Description string  `json:"description"`
		Total       float64 `json:"total"`
		Entries     []any   `json:"entries"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &history); err != nil {
		t.Fatalf("decode history: %v", err)
	}
	if len(history) != 2 || history[0].Description != "Newer" || history[1].Description != "Older" {
		t.Fatalf("history order = %#v", history)
	}
	if history[0].Total != 10.25 || len(history[0].Entries) != 1 {
		t.Fatalf("single deposit = %#v", history[0])
	}
}

func TestIncomeActivityDiscriminatesNormalGeneratedAndReserveDeposit(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	general := listTestReserves(t, srv, token, false)[0]

	insertTxn(t, pool, userID, "income", "Salary", 85000, "2026-09-10", "cash")
	deposit := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
		"description": "RSU vest", "date": "2026-09-18",
		"allocations": []map[string]any{{"reserve_id": general.ID, "amount": 60000}},
	})
	if deposit.Code != http.StatusCreated {
		t.Fatalf("create reserve deposit status = %d body = %s", deposit.Code, deposit.Body.String())
	}
	if _, err := pool.Exec(context.Background(), `
		WITH operation AS (
			INSERT INTO reserve_operations (user_id, operation_type, occurred_on, description)
			VALUES ($1, 'move_to_income', '2026-09-20', 'From General Reserve') RETURNING id
		), entry AS (
			INSERT INTO reserve_entries (operation_id, reserve_id, direction, amount)
			SELECT id, $2, 'withdrawal', 5000 FROM operation
		), txn AS (
			INSERT INTO transactions (user_id, section, category, amount, txn_date, kind)
			VALUES ($1, 'income', 'From General Reserve', 5000, '2026-09-20', 'cash') RETURNING id
		)
		INSERT INTO reserve_operation_transactions (reserve_operation_id, transaction_id, role)
		SELECT operation.id, txn.id, 'funding_income' FROM operation, txn`, userID, general.ID); err != nil {
		t.Fatalf("insert generated income fixture: %v", err)
	}

	rr := apiRequest(t, srv, token, http.MethodGet, "/api/income-activity?month=2026-09", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("income activity status = %d body = %s", rr.Code, rr.Body.String())
	}
	var items []struct {
		Source         string  `json:"source"`
		Nature         string  `json:"nature"`
		CountsAsIncome bool    `json:"counts_as_income"`
		Description    string  `json:"description"`
		Amount         float64 `json:"amount"`
		Date           string  `json:"date"`
		Allocations    []any   `json:"allocations"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &items); err != nil {
		t.Fatalf("decode income activity: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("income activity = %#v, want 3 items", items)
	}
	if items[0].Nature != "from_reserve" || items[0].Source != "normal_transaction" || !items[0].CountsAsIncome || items[0].Amount != 5000 {
		t.Fatalf("generated activity = %#v", items[0])
	}
	if items[1].Nature != "sent_to_reserves" || items[1].Source != "reserve_deposit" || items[1].CountsAsIncome || items[1].Amount != 60000 || len(items[1].Allocations) != 1 {
		t.Fatalf("reserve deposit activity = %#v", items[1])
	}
	if items[2].Nature != "normal_income" || items[2].Source != "normal_transaction" || !items[2].CountsAsIncome || items[2].Amount != 85000 {
		t.Fatalf("normal activity = %#v", items[2])
	}
}

func TestIncomeActivitySameDateOrderingUsesDescendingID(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO transactions (id, user_id, section, category, amount, txn_date, kind, created_at)
		VALUES
		('00000000-0000-0000-0000-000000000001', $1, 'income', 'First ID', 1, '2026-09-10', 'cash', '2026-09-10T12:00:00Z'),
		('00000000-0000-0000-0000-000000000002', $1, 'income', 'Second ID', 2, '2026-09-10', 'cash', '2026-09-10T12:00:00Z')`, userID); err != nil {
		t.Fatalf("insert same-date income: %v", err)
	}
	rr := apiRequest(t, srv, token, http.MethodGet, "/api/income-activity?month=2026-09", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("income activity status = %d body = %s", rr.Code, rr.Body.String())
	}
	var items []struct {
		Description string `json:"description"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &items); err != nil {
		t.Fatalf("decode activity: %v", err)
	}
	if len(items) != 2 || items[0].Description != "Second ID" || items[1].Description != "First ID" {
		t.Fatalf("same-date activity order = %#v", items)
	}
}

func TestReserveSpendingCreatesWithdrawalWithoutNormalTransaction(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	general := listTestReserves(t, srv, token, false)[0]
	loan := createTestReserve(t, srv, token, "Loan Reserve")
	deposit := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
		"description": "Loan funding", "date": "2026-09-01", "allocations": []map[string]any{{"reserve_id": loan.ID, "amount": 120000}},
	})
	if deposit.Code != http.StatusCreated {
		t.Fatalf("fund reserve status = %d body = %s", deposit.Code, deposit.Body.String())
	}
	before := apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/monthly?month=2026-09", nil).Body.String()

	rr := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/spending", map[string]any{
		"reserve_id": loan.ID, "amount": 100000, "date": "2026-09-18", "description": "Loan settlement", "note": "Final payment",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("spend status = %d body = %s", rr.Code, rr.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode spending: %v", err)
	}
	if operation.OperationType != "reserve_spend" || operation.Total != "100000.00" || len(operation.Entries) != 1 || operation.Entries[0].Direction != "withdrawal" {
		t.Fatalf("operation = %#v", operation)
	}
	balances := listTestReserves(t, srv, token, false)
	for _, reserve := range balances {
		if reserve.ID == loan.ID && reserve.Balance != 20000 {
			t.Fatalf("loan balance = %v, want 20000", reserve.Balance)
		}
		if reserve.ID == general.ID && reserve.Balance != 0 {
			t.Fatalf("general balance = %v, want 0", reserve.Balance)
		}
	}
	var transactionCount int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE user_id = $1`, userID).Scan(&transactionCount); err != nil {
		t.Fatalf("count transactions: %v", err)
	}
	if transactionCount != 0 {
		t.Fatalf("transactions = %d, want 0", transactionCount)
	}
	after := apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/monthly?month=2026-09", nil).Body.String()
	if before != after {
		t.Fatalf("reserve spending changed dashboard. before=%s after=%s", before, after)
	}
}

func TestReserveSpendingRejectsOverdraftPerReserveAndConcurrentWithdrawals(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	loan := createTestReserve(t, srv, token, "Loan Reserve")
	other := createTestReserve(t, srv, token, "Other Reserve")
	deposit := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
		"description": "Loan funding", "date": "2026-09-01", "allocations": []map[string]any{{"reserve_id": loan.ID, "amount": 100000}, {"reserve_id": other.ID, "amount": 100000}},
	})
	if deposit.Code != http.StatusCreated {
		t.Fatalf("fund reserves status = %d body = %s", deposit.Code, deposit.Body.String())
	}
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/spending", map[string]any{
		"reserve_id": loan.ID, "amount": 100001, "date": "2026-09-18", "description": "Too much",
	}), http.StatusConflict, "insufficient balance in Loan Reserve")

	const attempts = 2
	start := make(chan struct{})
	results := make(chan int, attempts)
	for range attempts {
		go func() {
			<-start
			rr := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/spending", map[string]any{
				"reserve_id": loan.ID, "amount": 60000, "date": "2026-09-19", "description": "Concurrent spend",
			})
			results <- rr.Code
		}()
	}
	close(start)
	statuses := []int{<-results, <-results}
	if !((statuses[0] == http.StatusCreated && statuses[1] == http.StatusConflict) || (statuses[1] == http.StatusCreated && statuses[0] == http.StatusConflict)) {
		t.Fatalf("concurrent statuses = %#v, want one created and one conflict", statuses)
	}
}

func TestReserveSpendingCanBeEditedAndDeletedAtomically(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	loan := createTestReserve(t, srv, token, "Loan Reserve")
	other := createTestReserve(t, srv, token, "Other Reserve")
	deposit := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
		"description": "Funding", "date": "2026-09-01", "allocations": []map[string]any{{"reserve_id": loan.ID, "amount": 100000}, {"reserve_id": other.ID, "amount": 50000}},
	})
	if deposit.Code != http.StatusCreated {
		t.Fatalf("fund status = %d body = %s", deposit.Code, deposit.Body.String())
	}
	created := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/spending", map[string]any{
		"reserve_id": loan.ID, "amount": 60000, "date": "2026-09-10", "description": "Settlement", "note": "first",
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("spend status = %d body = %s", created.Code, created.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(created.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode spending: %v", err)
	}
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPatch, "/api/reserve-operations/"+operation.ID, map[string]any{
		"reserve_id": loan.ID, "amount": 200000, "date": "2026-09-11", "description": "Impossible settlement",
	}), http.StatusConflict, "insufficient balance in Loan Reserve")
	updated := apiRequest(t, srv, token, http.MethodPatch, "/api/reserve-operations/"+operation.ID, map[string]any{
		"reserve_id": loan.ID, "amount": 80000, "date": "2026-09-11", "description": "Corrected settlement", "note": "corrected",
	})
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d body = %s", updated.Code, updated.Body.String())
	}
	balances := listTestReserves(t, srv, token, false)
	for _, reserve := range balances {
		if reserve.ID == loan.ID && reserve.Balance != 20000 {
			t.Fatalf("loan after update = %v, want 20000", reserve.Balance)
		}
	}
	deleted := apiRequest(t, srv, token, http.MethodDelete, "/api/reserve-operations/"+operation.ID, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d body = %s", deleted.Code, deleted.Body.String())
	}
	balances = listTestReserves(t, srv, token, false)
	for _, reserve := range balances {
		if reserve.ID == loan.ID && reserve.Balance != 100000 {
			t.Fatalf("loan after delete = %v, want 100000", reserve.Balance)
		}
	}
}

func TestArchivedReserveSpendingCannotBeDeleted(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	reserve := createTestReserve(t, srv, token, "Archived Loan")
	deposit := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
		"description": "Funding", "date": "2026-09-01", "allocations": []map[string]any{{"reserve_id": reserve.ID, "amount": 1000}},
	})
	if deposit.Code != http.StatusCreated {
		t.Fatalf("fund status = %d body = %s", deposit.Code, deposit.Body.String())
	}
	spend := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/spending", map[string]any{
		"reserve_id": reserve.ID, "amount": 500, "date": "2026-09-02", "description": "Spend",
	})
	if spend.Code != http.StatusCreated {
		t.Fatalf("spend status = %d body = %s", spend.Code, spend.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(spend.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode spending: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE reserves SET archived_at = now() WHERE id = $1`, reserve.ID); err != nil {
		t.Fatalf("archive fixture: %v", err)
	}
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/spending", map[string]any{
		"reserve_id": reserve.ID, "amount": 100, "date": "2026-09-03", "description": "Archived spend",
	}), http.StatusConflict, "archived reserves cannot receive spending")
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPatch, "/api/reserve-operations/"+operation.ID, map[string]any{
		"reserve_id": reserve.ID, "amount": 400, "date": "2026-09-04", "description": "Edited archived spend",
	}), http.StatusConflict, "archived reserves cannot receive spending")
	history := apiRequest(t, srv, token, http.MethodGet, "/api/reserve-operations?year=2026", nil)
	if history.Code != http.StatusOK {
		t.Fatalf("history status = %d body = %s", history.Code, history.Body.String())
	}
	var operations []ReserveOperationDTO
	if err := json.Unmarshal(history.Body.Bytes(), &operations); err != nil || len(operations) != 2 {
		t.Fatalf("history = %s err = %v", history.Body.String(), err)
	}
	if operations[0].Editable || operations[0].Deletable {
		t.Fatalf("archived operation policy = %+v, want non-actionable", operations[0])
	}
	assertReserveError(t, apiRequest(t, srv, token, http.MethodDelete, "/api/reserve-operations/"+operation.ID, nil), http.StatusConflict, "archived reserve operations cannot be changed")
}

func TestReserveTransferAndArchivalLifecycle(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	general := listTestReserves(t, srv, token, false)[0]
	from := createTestReserve(t, srv, token, "Ceremony Reserve")
	to := createTestReserve(t, srv, token, "Loan Reserve")
	fund := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
		"description": "Funding", "date": "2026-09-01", "allocations": []map[string]any{{"reserve_id": from.ID, "amount": 100000}},
	})
	if fund.Code != http.StatusCreated {
		t.Fatalf("fund status = %d body = %s", fund.Code, fund.Body.String())
	}
	before := apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/monthly?month=2026-09", nil).Body.String()
	transfer := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/transfers", map[string]any{
		"from_reserve_id": from.ID, "to_reserve_id": to.ID, "amount": 20000, "date": "2026-09-18", "note": "Reallocated",
	})
	if transfer.Code != http.StatusCreated {
		t.Fatalf("transfer status = %d body = %s", transfer.Code, transfer.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(transfer.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode transfer: %v", err)
	}
	if operation.OperationType != "transfer" || len(operation.Entries) != 2 || operation.Editable || !operation.Deletable {
		t.Fatalf("transfer operation = %#v", operation)
	}
	balances := listTestReserves(t, srv, token, false)
	for _, reserve := range balances {
		if reserve.ID == from.ID && reserve.Balance != 80000 {
			t.Fatalf("source balance = %v", reserve.Balance)
		}
		if reserve.ID == to.ID && reserve.Balance != 20000 {
			t.Fatalf("destination balance = %v", reserve.Balance)
		}
	}
	after := apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/monthly?month=2026-09", nil).Body.String()
	if before != after {
		t.Fatalf("transfer changed dashboard")
	}
	var transactions int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE user_id = $1`, userID).Scan(&transactions); err != nil {
		t.Fatalf("count transactions: %v", err)
	}
	if transactions != 0 {
		t.Fatalf("transactions = %d, want 0", transactions)
	}

	if _, err := pool.Exec(context.Background(), `UPDATE reserves SET archived_at = now() WHERE id = $1`, to.ID); err != nil {
		t.Fatalf("archive fixture: %v", err)
	}
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/transfers", map[string]any{
		"from_reserve_id": from.ID, "to_reserve_id": to.ID, "amount": 1, "date": "2026-09-19",
	}), http.StatusConflict, "archived reserves cannot receive transfers")
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/transfers", map[string]any{
		"from_reserve_id": from.ID, "to_reserve_id": from.ID, "amount": 1, "date": "2026-09-19",
	}), http.StatusBadRequest, "source and destination reserves must differ")

	deleted := apiRequest(t, srv, token, http.MethodDelete, "/api/reserve-operations/"+operation.ID, nil)
	if deleted.Code != http.StatusConflict {
		t.Fatalf("delete transfer with archived side status = %d body = %s", deleted.Code, deleted.Body.String())
	}

	// Empty non-General reserves can be archived and delete; General cannot.
	empty := createTestReserve(t, srv, token, "Empty Reserve")
	archive := apiRequest(t, srv, token, http.MethodPost, "/api/reserves/"+empty.ID+"/archive", nil)
	if archive.Code != http.StatusNoContent {
		t.Fatalf("archive status = %d body = %s", archive.Code, archive.Body.String())
	}
	if got := listTestReserves(t, srv, token, true); len(got) != 4 {
		t.Fatalf("all reserves = %d, want 4", len(got))
	}
	if delete := apiRequest(t, srv, token, http.MethodDelete, "/api/reserves/"+empty.ID, nil); delete.Code != http.StatusConflict {
		t.Fatalf("delete archived reserve status = %d", delete.Code)
	}
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPost, "/api/reserves/"+general.ID+"/archive", nil), http.StatusConflict, "general reserve cannot be archived")
}

func TestDepositMaintenanceReplacesAllocationsAndDeletesAtomically(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	first := createTestReserve(t, srv, token, "First Reserve")
	second := createTestReserve(t, srv, token, "Second Reserve")
	created := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
		"description": "Bonus", "date": "2026-09-01", "note": "old", "allocations": []map[string]any{{"reserve_id": first.ID, "amount": 100}, {"reserve_id": second.ID, "amount": 50}},
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create deposit status = %d body = %s", created.Code, created.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(created.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode deposit: %v", err)
	}
	updated := apiRequest(t, srv, token, http.MethodPatch, "/api/reserve-operations/"+operation.ID, map[string]any{
		"description": "Corrected bonus", "date": "2026-09-02", "note": "new", "allocations": []map[string]any{{"reserve_id": first.ID, "amount": 25}},
	})
	if updated.Code != http.StatusOK {
		t.Fatalf("update deposit status = %d body = %s", updated.Code, updated.Body.String())
	}
	balances := listTestReserves(t, srv, token, false)
	for _, reserve := range balances {
		if reserve.ID == first.ID && reserve.Balance != 25 {
			t.Fatalf("first balance = %v", reserve.Balance)
		}
		if reserve.ID == second.ID && reserve.Balance != 0 {
			t.Fatalf("second balance = %v", reserve.Balance)
		}
	}
	deleted := apiRequest(t, srv, token, http.MethodDelete, "/api/reserve-operations/"+operation.ID, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete deposit status = %d body = %s", deleted.Code, deleted.Body.String())
	}
	balances = listTestReserves(t, srv, token, false)
	for _, reserve := range balances {
		if reserve.ID == first.ID && reserve.Balance != 0 {
			t.Fatalf("first after delete = %v", reserve.Balance)
		}
	}
}

func TestIncomeToReserveAndBackConversion(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	first := createTestReserve(t, srv, token, "First Reserve")
	second := createTestReserve(t, srv, token, "Second Reserve")
	incomeID := insertTxn(t, pool, userID, "income", "RSU vest", 260000, "2026-09-18", "cash")
	converted := apiRequest(t, srv, token, http.MethodPost, "/api/transactions/"+incomeID.String()+"/convert-to-reserves", map[string]any{
		"allocations": []map[string]any{{"reserve_id": first.ID, "amount": 100000}, {"reserve_id": second.ID, "amount": 160000}},
	})
	if converted.Code != http.StatusCreated {
		t.Fatalf("convert status = %d body = %s", converted.Code, converted.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(converted.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode converted operation: %v", err)
	}
	if operation.Description != "RSU vest" || operation.Total != "260000.00" {
		t.Fatalf("converted operation = %#v", operation)
	}
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE id = $1`, incomeID).Scan(&count); err != nil {
		t.Fatalf("source count: %v", err)
	}
	if count != 0 {
		t.Fatalf("source income still exists")
	}
	back := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/"+operation.ID+"/convert-to-income", nil)
	if back.Code != http.StatusCreated {
		t.Fatalf("reverse status = %d body = %s", back.Code, back.Body.String())
	}
	var txn TransactionDTO
	if err := json.Unmarshal(back.Body.Bytes(), &txn); err != nil {
		t.Fatalf("decode reverse transaction: %v", err)
	}
	if txn.Section != "income" || txn.Category != "RSU vest" || txn.Amount != 260000 || txn.Date != "2026-09-18" || txn.Kind != "cash" {
		t.Fatalf("reverse transaction = %#v", txn)
	}
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM reserve_operations WHERE id = $1`, operation.ID).Scan(&count); err != nil {
		t.Fatalf("operation count: %v", err)
	}
	if count != 0 {
		t.Fatalf("reserve operation still exists")
	}
}

func TestConversionRejectsPartialAndSpentReverse(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	reserve := createTestReserve(t, srv, token, "Conversion Reserve")
	incomeID := insertTxn(t, pool, userID, "income", "Bonus", 1000, "2026-09-18", "cash")
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPost, "/api/transactions/"+incomeID.String()+"/convert-to-reserves", map[string]any{
		"allocations": []map[string]any{{"reserve_id": reserve.ID, "amount": 999}},
	}), http.StatusBadRequest, "allocation total must equal the income amount")
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE id = $1`, incomeID).Scan(&count); err != nil {
		t.Fatalf("source count: %v", err)
	}
	if count != 1 {
		t.Fatalf("partial conversion removed source")
	}

	deposit := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{
		"description": "Spendable", "date": "2026-09-18", "allocations": []map[string]any{{"reserve_id": reserve.ID, "amount": 100}},
	})
	if deposit.Code != http.StatusCreated {
		t.Fatalf("deposit status = %d body = %s", deposit.Code, deposit.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(deposit.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode deposit: %v", err)
	}
	spend := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/spending", map[string]any{"reserve_id": reserve.ID, "amount": 100, "date": "2026-09-19", "description": "Spent"})
	if spend.Code != http.StatusCreated {
		t.Fatalf("spend status = %d body = %s", spend.Code, spend.Body.String())
	}
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/"+operation.ID+"/convert-to-income", nil), http.StatusConflict, "deposit cannot be converted because an allocation has already been spent")
}

func TestMoveReserveMoneyToIncomeCreatesProtectedGeneratedIncome(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	reserve := createTestReserve(t, srv, token, "Move Reserve")
	fund := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{"description": "Funding", "date": "2026-09-01", "allocations": []map[string]any{{"reserve_id": reserve.ID, "amount": 20000}}})
	if fund.Code != http.StatusCreated {
		t.Fatalf("fund status = %d body = %s", fund.Code, fund.Body.String())
	}
	income := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/income-transfers", map[string]any{"reserve_id": reserve.ID, "amount": 15000, "date": "2026-09-18", "description": "From General Reserve", "note": "For spending"})
	if income.Code != http.StatusCreated {
		t.Fatalf("income transfer status = %d body = %s", income.Code, income.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(income.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode operation: %v", err)
	}
	if operation.OperationType != "move_to_income" || operation.Total != "15000.00" || operation.Editable || !operation.Deletable {
		t.Fatalf("operation = %#v", operation)
	}
	var generatedID string
	if err := pool.QueryRow(context.Background(), `SELECT transaction_id FROM reserve_operation_transactions WHERE reserve_operation_id = $1`, operation.ID).Scan(&generatedID); err != nil {
		t.Fatalf("generated link: %v", err)
	}
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE user_id = $1 AND section = 'income' AND amount = 15000`, userID).Scan(&count); err != nil {
		t.Fatalf("income count: %v", err)
	}
	if count != 1 {
		t.Fatalf("generated income count = %d", count)
	}
	assertReserveError(t, apiRequest(t, srv, token, http.MethodPatch, "/api/transactions/"+generatedID, map[string]any{"category": "Hacked"}), http.StatusConflict, "generated reserve transactions must be changed through their reserve operation")
	assertReserveError(t, apiRequest(t, srv, token, http.MethodDelete, "/api/transactions/"+generatedID, nil), http.StatusConflict, "generated reserve transactions must be changed through their reserve operation")
	deleted := apiRequest(t, srv, token, http.MethodDelete, "/api/reserve-operations/"+operation.ID, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete operation status = %d body = %s", deleted.Code, deleted.Body.String())
	}
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE id = $1`, generatedID).Scan(&count); err != nil {
		t.Fatalf("deleted generated count: %v", err)
	}
	if count != 0 {
		t.Fatalf("generated transaction remains")
	}
}

func TestFundedExpenseCreatesPairedCashTransactionsAndDeletesTogether(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()
	reserve := createTestReserve(t, srv, token, "Car Reserve")
	fund := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{"description": "Funding", "date": "2026-09-01", "allocations": []map[string]any{{"reserve_id": reserve.ID, "amount": 10000}}})
	if fund.Code != http.StatusCreated {
		t.Fatalf("fund status = %d body = %s", fund.Code, fund.Body.String())
	}
	expense := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/funded-expenses", map[string]any{"reserve_id": reserve.ID, "amount": 8000, "date": "2026-09-18", "section": "daily", "category": "Tyre replacement", "note": "Rear tyre"})
	if expense.Code != http.StatusCreated {
		t.Fatalf("funded expense status = %d body = %s", expense.Code, expense.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(expense.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode funded expense: %v", err)
	}
	if operation.OperationType != "funded_expense" || operation.Total != "8000" || operation.Editable || !operation.Deletable {
		t.Fatalf("operation = %#v", operation)
	}
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE user_id = $1`, userID).Scan(&count); err != nil {
		t.Fatalf("transaction count: %v", err)
	}
	if count != 2 {
		t.Fatalf("transactions = %d, want income + expense", count)
	}
	var income, expenseAmount float64
	if err := pool.QueryRow(context.Background(), `SELECT COALESCE(SUM(amount) FILTER (WHERE section = 'income'), 0), COALESCE(SUM(amount) FILTER (WHERE section = 'daily'), 0) FROM transactions WHERE user_id = $1`, userID).Scan(&income, &expenseAmount); err != nil {
		t.Fatalf("analytics rows: %v", err)
	}
	if income != 8000 || expenseAmount != 8000 {
		t.Fatalf("income/expense = %v/%v", income, expenseAmount)
	}
	deleted := apiRequest(t, srv, token, http.MethodDelete, "/api/reserve-operations/"+operation.ID, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete funded expense status = %d body = %s", deleted.Code, deleted.Body.String())
	}
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM transactions WHERE user_id = $1`, userID).Scan(&count); err != nil {
		t.Fatalf("post-delete count: %v", err)
	}
	if count != 0 {
		t.Fatalf("generated transactions remain = %d", count)
	}
}

func TestReserveOperationOwnershipDoesNotLeakResources(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	reserve := createTestReserve(t, srv, token, "Private Reserve")
	deposit := apiRequest(t, srv, token, http.MethodPost, "/api/reserve-operations/deposits", map[string]any{"description": "Private", "date": "2026-09-01", "allocations": []map[string]any{{"reserve_id": reserve.ID, "amount": 1000}}})
	if deposit.Code != http.StatusCreated {
		t.Fatalf("deposit status = %d body = %s", deposit.Code, deposit.Body.String())
	}
	var operation ReserveOperationDTO
	if err := json.Unmarshal(deposit.Body.Bytes(), &operation); err != nil {
		t.Fatalf("decode operation: %v", err)
	}
	otherID := uuid.New()
	if err := srv.provisionUser(context.Background(), auth.Identity{UserID: otherID, Email: "operation-other@example.com"}); err != nil {
		t.Fatalf("provision other user: %v", err)
	}
	otherToken := signedTestToken(t, otherID)
	if listed := apiRequest(t, srv, otherToken, http.MethodGet, "/api/reserve-operations?year=2026", nil); listed.Code != http.StatusOK || listed.Body.String() != "[]\n" {
		t.Fatalf("other user history = %d %s", listed.Code, listed.Body.String())
	}
	assertReserveError(t, apiRequest(t, srv, otherToken, http.MethodPatch, "/api/reserve-operations/"+operation.ID, map[string]any{"description": "Stolen", "date": "2026-09-02", "allocations": []map[string]any{{"reserve_id": reserve.ID, "amount": 1000}}}), http.StatusNotFound, "reserve operation not found")
	assertReserveError(t, apiRequest(t, srv, otherToken, http.MethodDelete, "/api/reserve-operations/"+operation.ID, nil), http.StatusNotFound, "reserve operation not found")
}

func createTestReserve(t *testing.T, srv *Server, token, name string) reserveTestDTO {
	t.Helper()
	rr := apiRequest(t, srv, token, http.MethodPost, "/api/reserves", map[string]any{"name": name})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create reserve %q status = %d body = %s", name, rr.Code, rr.Body.String())
	}
	var reserve reserveTestDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &reserve); err != nil {
		t.Fatalf("decode reserve: %v", err)
	}
	return reserve
}

func listTestReserves(t *testing.T, srv *Server, token string, includeArchived bool) []reserveTestDTO {
	t.Helper()
	value := "false"
	if includeArchived {
		value = "true"
	}
	rr := apiRequest(t, srv, token, http.MethodGet, "/api/reserves?include_archived="+value, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list reserves status = %d body = %s", rr.Code, rr.Body.String())
	}
	var out []reserveTestDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode reserves: %v", err)
	}
	return out
}

func assertReserveError(t *testing.T, rr *httptest.ResponseRecorder, wantStatus int, wantMessage string) {
	t.Helper()
	if rr.Code != wantStatus {
		t.Fatalf("status = %d body = %s, want %d", rr.Code, rr.Body.String(), wantStatus)
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if body["error"] != wantMessage {
		t.Fatalf("error = %q, want %q", body["error"], wantMessage)
	}
}
