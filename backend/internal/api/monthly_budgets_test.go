package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestMonthlyBudgets(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	missing := apiRequest(t, srv, token, http.MethodGet, "/api/budgets/2026-05", nil)
	if missing.Code != http.StatusOK {
		t.Fatalf("missing status = %d body = %s", missing.Code, missing.Body.String())
	}
	assertMonthlyBudgetResponse(t, missing, MonthlyBudgetDTO{Month: "2026-05"})

	created := apiRequest(t, srv, token, http.MethodPut, "/api/budgets/2026-06", map[string]any{
		"essential": 10000.25,
		"flexible":  5000,
		"daily":     15000.75,
	})
	if created.Code != http.StatusOK {
		t.Fatalf("create status = %d body = %s", created.Code, created.Body.String())
	}
	assertMonthlyBudgetResponse(t, created, MonthlyBudgetDTO{
		Month: "2026-06", Essential: 10000.25, Flexible: 5000, Daily: 15000.75,
	})

	updated := apiRequest(t, srv, token, http.MethodPut, "/api/budgets/2026-06", map[string]any{
		"essential": 12000,
		"flexible":  6000,
		"daily":     0,
	})
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d body = %s", updated.Code, updated.Body.String())
	}
	assertMonthlyBudgetResponse(t, updated, MonthlyBudgetDTO{
		Month: "2026-06", Essential: 12000, Flexible: 6000,
	})

	apiRequest(t, srv, token, http.MethodPut, "/api/budgets/2026-07", map[string]any{
		"essential": 1, "flexible": 2, "daily": 3,
	})
	listed := apiRequest(t, srv, token, http.MethodGet, "/api/budgets", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("list status = %d body = %s", listed.Code, listed.Body.String())
	}
	var budgets []MonthlyBudgetDTO
	if err := json.Unmarshal(listed.Body.Bytes(), &budgets); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(budgets) != 2 || budgets[0].Month != "2026-07" || budgets[1].Month != "2026-06" {
		t.Fatalf("budgets = %#v, want configured months in descending order", budgets)
	}

	otherToken := signedTestToken(t, uuid.New())
	other := apiRequest(t, srv, otherToken, http.MethodGet, "/api/budgets/2026-06", nil)
	if other.Code != http.StatusOK {
		t.Fatalf("other status = %d body = %s", other.Code, other.Body.String())
	}
	assertMonthlyBudgetResponse(t, other, MonthlyBudgetDTO{Month: "2026-06"})
}

func TestMonthlyBudgetValidation(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	tests := []struct {
		name string
		path string
		body any
	}{
		{name: "invalid month", path: "/api/budgets/2026-13", body: map[string]any{"essential": 1, "flexible": 2, "daily": 3}},
		{name: "missing field", path: "/api/budgets/2026-06", body: map[string]any{"essential": 1, "flexible": 2}},
		{name: "negative", path: "/api/budgets/2026-06", body: map[string]any{"essential": -1, "flexible": 2, "daily": 3}},
		{name: "excess precision", path: "/api/budgets/2026-06", body: map[string]any{"essential": 1.001, "flexible": 2, "daily": 3}},
		{name: "too large", path: "/api/budgets/2026-06", body: map[string]any{"essential": 1000000000000.0, "flexible": 2, "daily": 3}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rr := apiRequest(t, srv, token, http.MethodPut, tc.path, tc.body)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body = %s, want %d", rr.Code, rr.Body.String(), http.StatusBadRequest)
			}
		})
	}
}

func assertMonthlyBudgetResponse(t *testing.T, rr *httptest.ResponseRecorder, want MonthlyBudgetDTO) {
	t.Helper()
	var got MonthlyBudgetDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode budget: %v", err)
	}
	if got.Month != want.Month {
		t.Fatalf("month = %q, want %q", got.Month, want.Month)
	}
	assertFloat(t, "essential", got.Essential, want.Essential)
	assertFloat(t, "flexible", got.Flexible, want.Flexible)
	assertFloat(t, "daily", got.Daily, want.Daily)
}
