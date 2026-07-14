package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/auth"
)

func TestLentRepaymentLifecycle(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	lent := createLent(t, srv, token, map[string]any{
		"counterparty": "Ravi",
		"amount":       5000,
		"lent_on":      "2026-06-01",
		"due_on":       "2026-07-01",
		"note":         "bike repair",
	})
	if lent.Outstanding != 5000 || lent.Status != "open" {
		t.Fatalf("new lent outstanding = %v status = %q, want 5000/open", lent.Outstanding, lent.Status)
	}

	// Partial repayment leaves the loan open.
	addRepayment(t, srv, token, lent.ID, 2000, "2026-06-15", http.StatusCreated)

	got := getLent(t, srv, token, lent.ID)
	if got.RepaidTotal != 2000 || got.Outstanding != 3000 || got.Status != "open" {
		t.Fatalf("after partial: repaid = %v outstanding = %v status = %q, want 2000/3000/open",
			got.RepaidTotal, got.Outstanding, got.Status)
	}
	if len(got.Repayments) != 1 {
		t.Fatalf("repayment history length = %d, want 1", len(got.Repayments))
	}

	// Over-repaying the remaining 3000 is rejected and changes nothing.
	addRepayment(t, srv, token, lent.ID, 3001, "2026-06-20", http.StatusBadRequest)
	if still := getLent(t, srv, token, lent.ID); still.Outstanding != 3000 {
		t.Fatalf("outstanding after rejected over-repayment = %v, want 3000", still.Outstanding)
	}

	// Paying the exact remainder settles it.
	addRepayment(t, srv, token, lent.ID, 3000, "2026-06-25", http.StatusCreated)

	got = getLent(t, srv, token, lent.ID)
	if got.Outstanding != 0 || got.Status != "settled" {
		t.Fatalf("after full repayment: outstanding = %v status = %q, want 0/settled", got.Outstanding, got.Status)
	}
	if len(got.Repayments) != 2 {
		t.Fatalf("repayment history length = %d, want 2", len(got.Repayments))
	}

	// A settled loan drops out of ?status=open but stays in ?status=settled.
	if open := listLents(t, srv, token, "open"); len(open) != 0 {
		t.Fatalf("open lents = %d, want 0", len(open))
	}
	settled := listLents(t, srv, token, "settled")
	if len(settled) != 1 || settled[0].ID != lent.ID {
		t.Fatalf("settled lents = %#v, want the one lent", settled)
	}
}

func TestLentDeleteCascadesRepayments(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	lent := createLent(t, srv, token, map[string]any{
		"counterparty": "Meera",
		"amount":       1000,
		"lent_on":      "2026-06-01",
	})
	addRepayment(t, srv, token, lent.ID, 400, "2026-06-10", http.StatusCreated)

	rr := apiRequest(t, srv, token, http.MethodDelete, "/api/lents/"+lent.ID, nil)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d body = %s", rr.Code, rr.Body.String())
	}

	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM lent_repayments WHERE lent_id = $1`, lent.ID).Scan(&count); err != nil {
		t.Fatalf("count repayments: %v", err)
	}
	if count != 0 {
		t.Fatalf("orphaned repayments = %d, want 0", count)
	}
}

func TestLentIsScopedToOwner(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	lent := createLent(t, srv, token, map[string]any{
		"counterparty": "Ravi",
		"amount":       5000,
		"lent_on":      "2026-06-01",
	})

	// A second user must not be able to see or touch the first user's lent.
	otherID := uuid.New()
	if err := srv.provisionUser(context.Background(), auth.Identity{UserID: otherID, Email: "other@example.com"}); err != nil {
		t.Fatalf("provision second user: %v", err)
	}
	otherToken := signedTestToken(t, otherID)

	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"get", http.MethodGet, "/api/lents/" + lent.ID, nil},
		{"update", http.MethodPatch, "/api/lents/" + lent.ID, map[string]any{
			"counterparty": "Hijacked", "amount": 1, "lent_on": "2026-06-01",
		}},
		{"delete", http.MethodDelete, "/api/lents/" + lent.ID, nil},
		{"list repayments", http.MethodGet, "/api/lents/" + lent.ID + "/repayments", nil},
		{"add repayment", http.MethodPost, "/api/lents/" + lent.ID + "/repayments", map[string]any{
			"amount": 100, "repaid_on": "2026-06-10",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := apiRequest(t, srv, otherToken, tc.method, tc.path, tc.body)
			if rr.Code != http.StatusNotFound {
				t.Fatalf("status = %d body = %s, want %d", rr.Code, rr.Body.String(), http.StatusNotFound)
			}
		})
	}

	// The owner's lent is untouched.
	if got := getLent(t, srv, token, lent.ID); got.Counterparty != "Ravi" || got.Outstanding != 5000 {
		t.Fatalf("owner lent = %+v, want Ravi/5000 unchanged", got)
	}
	if lents := listLents(t, srv, otherToken, "all"); len(lents) != 0 {
		t.Fatalf("other user sees %d lents, want 0", len(lents))
	}
}

func TestLentValidation(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	cases := []struct {
		name string
		body map[string]any
	}{
		{"missing counterparty", map[string]any{"amount": 100, "lent_on": "2026-06-01"}},
		{"zero amount", map[string]any{"counterparty": "Ravi", "amount": 0, "lent_on": "2026-06-01"}},
		{"negative amount", map[string]any{"counterparty": "Ravi", "amount": -5, "lent_on": "2026-06-01"}},
		{"bad lent_on", map[string]any{"counterparty": "Ravi", "amount": 100, "lent_on": "01-06-2026"}},
		{"due before lent", map[string]any{
			"counterparty": "Ravi", "amount": 100, "lent_on": "2026-06-01", "due_on": "2026-05-01",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := apiRequest(t, srv, token, http.MethodPost, "/api/lents", tc.body)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body = %s, want %d", rr.Code, rr.Body.String(), http.StatusBadRequest)
			}
		})
	}
}

// TestLentDoesNotAffectDashboard is the isolation guarantee: recording a lent and
// a repayment must leave every existing money figure byte-for-byte identical.
func TestLentDoesNotAffectDashboard(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	insertTxn(t, pool, userID, "income", "Salary", 85000, "2026-06-01", "cash")
	insertTxn(t, pool, userID, "essential", "Rent", 10000, "2026-06-02", "cash")

	before := apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/monthly?month=2026-06", nil).Body.String()

	lent := createLent(t, srv, token, map[string]any{
		"counterparty": "Ravi",
		"amount":       5000,
		"lent_on":      "2026-06-10",
	})
	addRepayment(t, srv, token, lent.ID, 2000, "2026-06-20", http.StatusCreated)

	after := apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/monthly?month=2026-06", nil).Body.String()

	if before != after {
		t.Fatalf("lending changed the dashboard.\nbefore: %s\nafter:  %s", before, after)
	}
}

// --- helpers ---------------------------------------------------------------

func createLent(t *testing.T, srv *Server, token string, body map[string]any) LentDTO {
	t.Helper()

	rr := apiRequest(t, srv, token, http.MethodPost, "/api/lents", body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create lent status = %d body = %s", rr.Code, rr.Body.String())
	}
	var out LentDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode lent: %v", err)
	}
	return out
}

func getLent(t *testing.T, srv *Server, token, id string) LentDTO {
	t.Helper()

	rr := apiRequest(t, srv, token, http.MethodGet, "/api/lents/"+id, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get lent status = %d body = %s", rr.Code, rr.Body.String())
	}
	var out LentDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode lent: %v", err)
	}
	return out
}

func listLents(t *testing.T, srv *Server, token, status string) []LentDTO {
	t.Helper()

	rr := apiRequest(t, srv, token, http.MethodGet, "/api/lents?status="+status, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list lents status = %d body = %s", rr.Code, rr.Body.String())
	}
	var out []LentDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode lents: %v", err)
	}
	return out
}

func addRepayment(t *testing.T, srv *Server, token, lentID string, amount float64, on string, wantStatus int) {
	t.Helper()

	rr := apiRequest(t, srv, token, http.MethodPost, "/api/lents/"+lentID+"/repayments", map[string]any{
		"amount":    amount,
		"repaid_on": on,
	})
	if rr.Code != wantStatus {
		t.Fatalf("repayment status = %d body = %s, want %d", rr.Code, rr.Body.String(), wantStatus)
	}
}
