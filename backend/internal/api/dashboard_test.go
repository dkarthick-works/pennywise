package api

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDashboardMonthly(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	seedDashboardTransactions(t, pool, userID)

	tests := []struct {
		name string
		path string
		want DashboardMonthlyDTO
	}{
		{
			name: "mixed month",
			path: "/api/dashboard/monthly?month=2026-06",
			want: DashboardMonthlyDTO{
				Month:                   "2026-06",
				Income:                  85000,
				CashFlow:                16000,
				MonthlyCost:             19000,
				NetSaved:                69000,
				SavingsRate:             81.17647058823529,
				MonthlyDifference:       66000,
				OutstandingCreditsCount: 1,
				OutstandingCreditsTotal: 5000,
			},
		},
		{
			name: "empty month",
			path: "/api/dashboard/monthly?month=2026-07",
			want: DashboardMonthlyDTO{Month: "2026-07"},
		},
		{
			name: "zero income",
			path: "/api/dashboard/monthly?month=2026-08",
			want: DashboardMonthlyDTO{
				Month:                   "2026-08",
				CashFlow:                100,
				MonthlyCost:             150,
				NetSaved:                -100,
				SavingsRate:             0,
				MonthlyDifference:       -150,
				OutstandingCreditsCount: 1,
				OutstandingCreditsTotal: 50,
			},
		},
		{
			name: "negative savings rate",
			path: "/api/dashboard/monthly?month=2026-09",
			want: DashboardMonthlyDTO{
				Month:             "2026-09",
				Income:            100,
				CashFlow:          250,
				MonthlyCost:       250,
				NetSaved:          -150,
				SavingsRate:       -150,
				MonthlyDifference: -150,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rr := apiRequest(t, srv, token, http.MethodGet, tc.path, nil)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d body = %s", rr.Code, rr.Body.String())
			}
			var got DashboardMonthlyDTO
			if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode dashboard: %v", err)
			}
			assertDashboardMonthly(t, got, tc.want)
		})
	}
}

func TestDashboardMonthlyInvalidMonth(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	for _, path := range []string{
		"/api/dashboard/monthly?month=bad",
		"/api/dashboard/monthly?month=2026-13",
	} {
		rr := apiRequest(t, srv, token, http.MethodGet, path, nil)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d body = %s, want %d", path, rr.Code, rr.Body.String(), http.StatusBadRequest)
		}
	}
}

func seedDashboardTransactions(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	insertTxn(t, pool, userID, "income", "Salary", 85000, "2026-06-01", "cash")
	insertTxn(t, pool, userID, "essential", "Rent", 10000, "2026-06-02", "cash")
	insertTxn(t, pool, userID, "daily", "Card payment", 2000, "2026-06-03", "settlement")
	insertTxn(t, pool, userID, "flexible", "Trip", 5000, "2026-06-04", "credit")
	settledCreditID := insertTxn(t, pool, userID, "essential", "Groceries", 4000, "2026-06-05", "credit")
	settlementID := insertTxn(t, pool, userID, "essential", "Card payment", 4000, "2026-06-06", "settlement")
	insertTxn(t, pool, userID, "daily", "Other month", 999, "2026-05-31", "cash")

	if _, err := pool.Exec(ctx, `
		INSERT INTO settlement_links (settlement_id, credit_id)
		VALUES ($1, $2)
	`, settlementID, settledCreditID); err != nil {
		t.Fatalf("insert settlement link: %v", err)
	}

	insertTxn(t, pool, userID, "essential", "Utilities", 100, "2026-08-01", "cash")
	insertTxn(t, pool, userID, "flexible", "Open credit", 50, "2026-08-02", "credit")

	insertTxn(t, pool, userID, "income", "Small income", 100, "2026-09-01", "cash")
	insertTxn(t, pool, userID, "daily", "Large cash", 250, "2026-09-02", "cash")
}

func insertTxn(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, section, category string, amount float64, date, kind string) uuid.UUID {
	t.Helper()

	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO transactions (user_id, section, category, amount, txn_date, kind)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, userID, section, category, amount, date, kind).Scan(&id); err != nil {
		t.Fatalf("insert txn: %v", err)
	}
	return id
}

func assertDashboardMonthly(t *testing.T, got, want DashboardMonthlyDTO) {
	t.Helper()

	if got.Month != want.Month {
		t.Fatalf("month = %q, want %q", got.Month, want.Month)
	}
	assertFloat(t, "income", got.Income, want.Income)
	assertFloat(t, "cash_flow", got.CashFlow, want.CashFlow)
	assertFloat(t, "monthly_cost", got.MonthlyCost, want.MonthlyCost)
	assertFloat(t, "net_saved", got.NetSaved, want.NetSaved)
	assertFloat(t, "savings_rate", got.SavingsRate, want.SavingsRate)
	assertFloat(t, "monthly_difference", got.MonthlyDifference, want.MonthlyDifference)
	if got.OutstandingCreditsCount != want.OutstandingCreditsCount {
		t.Fatalf("outstanding_credits_count = %d, want %d", got.OutstandingCreditsCount, want.OutstandingCreditsCount)
	}
	assertFloat(t, "outstanding_credits_total", got.OutstandingCreditsTotal, want.OutstandingCreditsTotal)
}

func assertFloat(t *testing.T, field string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.000001 {
		t.Fatalf("%s = %v, want %v", field, got, want)
	}
}
