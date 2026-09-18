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
