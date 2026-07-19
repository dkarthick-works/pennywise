package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ledger/backend/internal/auth"
)

// setStatementDay PUTs the credit statement day and asserts the resulting DTO.
func setStatementDay(t *testing.T, srv *Server, token string, body any, wantStatus int) SettingsDTO {
	t.Helper()
	rr := apiRequest(t, srv, token, http.MethodPut, "/api/settings/credit-billing-cycle", body)
	if rr.Code != wantStatus {
		t.Fatalf("PUT credit-billing-cycle status = %d body = %s, want %d", rr.Code, rr.Body.String(), wantStatus)
	}
	var out SettingsDTO
	if wantStatus == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode settings: %v", err)
		}
	}
	return out
}

func TestUpdateCreditStatementDay(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	// Unset by default.
	rr := apiRequest(t, srv, token, http.MethodGet, "/api/settings", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get settings status = %d body = %s", rr.Code, rr.Body.String())
	}
	var got SettingsDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	if got.CreditStatementDay != nil {
		t.Fatalf("default statement day = %v, want nil", *got.CreditStatementDay)
	}

	// Set.
	out := setStatementDay(t, srv, token, map[string]any{"credit_statement_day": 15}, http.StatusOK)
	if out.CreditStatementDay == nil || *out.CreditStatementDay != 15 {
		t.Fatalf("set statement day = %v, want 15", out.CreditStatementDay)
	}

	// Replace.
	out = setStatementDay(t, srv, token, map[string]any{"credit_statement_day": 3}, http.StatusOK)
	if out.CreditStatementDay == nil || *out.CreditStatementDay != 3 {
		t.Fatalf("replace statement day = %v, want 3", out.CreditStatementDay)
	}

	// Clear with explicit null.
	out = setStatementDay(t, srv, token, map[string]any{"credit_statement_day": nil}, http.StatusOK)
	if out.CreditStatementDay != nil {
		t.Fatalf("cleared statement day = %v, want nil", *out.CreditStatementDay)
	}

	// Invalid payloads.
	setStatementDay(t, srv, token, map[string]any{}, http.StatusBadRequest)                     // missing property
	setStatementDay(t, srv, token, map[string]any{"credit_statement_day": 0}, http.StatusBadRequest)
	setStatementDay(t, srv, token, map[string]any{"credit_statement_day": 32}, http.StatusBadRequest)
	setStatementDay(t, srv, token, map[string]any{"credit_statement_day": 15.5}, http.StatusBadRequest)
	setStatementDay(t, srv, token, map[string]any{"credit_statement_day": "15"}, http.StatusBadRequest)
	setStatementDay(t, srv, token, map[string]any{"nope": 1}, http.StatusBadRequest) // unknown field
}

func TestCreditUsageSummary(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	seedCreditUsage(t, pool, userID)

	// Unconfigured: billing_cycle is explicit null, calendar still present.
	rr := apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/credit-usage?month=2026-07", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("credit-usage status = %d body = %s", rr.Code, rr.Body.String())
	}
	if !jsonHasNullField(t, rr.Body.Bytes(), "billing_cycle") {
		t.Fatalf("billing_cycle not explicit null: %s", rr.Body.String())
	}
	var summary CreditUsageDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary.BillingCycle != nil {
		t.Fatalf("billing_cycle = %#v, want nil", summary.BillingCycle)
	}
	// Calendar July: credits on 07-01, 07-15, 07-16, 07-31 (settled + unsettled)
	// = 100 + 200 + 400 + 800 = 1500 across 4 rows.
	assertFloat(t, "calendar total", summary.CalendarMonth.Total, 1500)
	if summary.CalendarMonth.Count != 4 {
		t.Fatalf("calendar count = %d, want 4", summary.CalendarMonth.Count)
	}
	if summary.CalendarMonth.From != "2026-07-01" || summary.CalendarMonth.To != "2026-07-31" {
		t.Fatalf("calendar window = %s..%s", summary.CalendarMonth.From, summary.CalendarMonth.To)
	}

	// Configure day 15: July cycle is Jun 16 .. Jul 15.
	setStatementDay(t, srv, token, map[string]any{"credit_statement_day": 15}, http.StatusOK)

	rr = apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/credit-usage?month=2026-07", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("credit-usage status = %d body = %s", rr.Code, rr.Body.String())
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary.BillingCycle == nil {
		t.Fatalf("billing_cycle nil after configuring")
	}
	// Cycle Jun16..Jul15 includes 06-16 (50), 06-30 (60), 07-01 (100), 07-15 (200)
	// and excludes 06-15 (30 -> previous cycle) and 07-16 (400 -> next cycle).
	if summary.BillingCycle.StatementDay != 15 {
		t.Fatalf("statement_day = %d, want 15", summary.BillingCycle.StatementDay)
	}
	if summary.BillingCycle.From != "2026-06-16" || summary.BillingCycle.To != "2026-07-15" {
		t.Fatalf("billing window = %s..%s, want 2026-06-16..2026-07-15", summary.BillingCycle.From, summary.BillingCycle.To)
	}
	assertFloat(t, "billing total", summary.BillingCycle.Total, 410)
	if summary.BillingCycle.Count != 4 {
		t.Fatalf("billing count = %d, want 4", summary.BillingCycle.Count)
	}
}

func TestCreditUsageInvalidMonth(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	for _, path := range []string{
		"/api/dashboard/credit-usage?month=bad",
		"/api/dashboard/credit-usage?month=2026-13",
		"/api/dashboard/credit-usage",
	} {
		rr := apiRequest(t, srv, token, http.MethodGet, path, nil)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, want 400", path, rr.Code)
		}
	}
}

func TestCreditTransactionsDrilldown(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	seedCreditUsage(t, pool, userID)
	setStatementDay(t, srv, token, map[string]any{"credit_statement_day": 15}, http.StatusOK)

	// Calendar view reconciles with the summary calendar bucket.
	cal := getCreditTransactions(t, srv, token, "/api/dashboard/credit-transactions?month=2026-07&view=calendar")
	if cal.View != "calendar" || cal.Count != 4 || len(cal.Transactions) != 4 {
		t.Fatalf("calendar drilldown = view %q count %d rows %d", cal.View, cal.Count, len(cal.Transactions))
	}
	assertFloat(t, "calendar drilldown total", cal.Total, 1500)

	// Billing view reconciles with the summary billing bucket.
	bill := getCreditTransactions(t, srv, token, "/api/dashboard/credit-transactions?month=2026-07&view=billing")
	if bill.View != "billing" || bill.Count != 4 || len(bill.Transactions) != 4 {
		t.Fatalf("billing drilldown = view %q count %d rows %d", bill.View, bill.Count, len(bill.Transactions))
	}
	assertFloat(t, "billing drilldown total", bill.Total, 410)
	if bill.From != "2026-06-16" || bill.To != "2026-07-15" {
		t.Fatalf("billing drilldown window = %s..%s", bill.From, bill.To)
	}

	// Default view is calendar.
	def := getCreditTransactions(t, srv, token, "/api/dashboard/credit-transactions?month=2026-07")
	if def.View != "calendar" {
		t.Fatalf("default view = %q, want calendar", def.View)
	}

	// Invalid view.
	rr := apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/credit-transactions?month=2026-07&view=nope", nil)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid view status = %d, want 400", rr.Code)
	}
}

func TestCreditTransactionsBillingRequiresStatementDay(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	seedCreditUsage(t, pool, userID)
	// No statement day configured.
	rr := apiRequest(t, srv, token, http.MethodGet, "/api/dashboard/credit-transactions?month=2026-07&view=billing", nil)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("billing without statement day status = %d body = %s, want 400", rr.Code, rr.Body.String())
	}
}

func TestCreditUsageScopedPerUser(t *testing.T) {
	srv, pool, _, userID := setupCategoryAPITest(t)
	defer pool.Close()

	seedCreditUsage(t, pool, userID)

	// A second user with their own transactions must not see the first user's.
	otherID := uuid.New()
	if err := srv.provisionUser(context.Background(), auth.Identity{UserID: otherID, Email: "other@example.com"}); err != nil {
		t.Fatalf("provision other user: %v", err)
	}
	otherToken := signedTestToken(t, otherID)
	insertTxn(t, pool, otherID, "essential", "Other credit", 999, "2026-07-10", "credit")

	rr := apiRequest(t, srv, otherToken, http.MethodGet, "/api/dashboard/credit-usage?month=2026-07", nil)
	var summary CreditUsageDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	assertFloat(t, "other user calendar total", summary.CalendarMonth.Total, 999)
	if summary.CalendarMonth.Count != 1 {
		t.Fatalf("other user calendar count = %d, want 1", summary.CalendarMonth.Count)
	}
}

// seedCreditUsage inserts a mix of rows spanning the July statement cycle
// boundary (day 15) plus non-credit noise that must be excluded.
func seedCreditUsage(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	// Previous-cycle boundary (excluded from Jun16..Jul15 cycle).
	insertTxn(t, pool, userID, "essential", "Jun15 credit", 30, "2026-06-15", "credit")
	// In-cycle June rows.
	insertTxn(t, pool, userID, "flexible", "Jun16 credit", 50, "2026-06-16", "credit")
	insertTxn(t, pool, userID, "daily", "Jun30 credit", 60, "2026-06-30", "credit")

	// July calendar rows.
	insertTxn(t, pool, userID, "essential", "Jul01 credit", 100, "2026-07-01", "credit")
	settled := insertTxn(t, pool, userID, "flexible", "Jul15 credit settled", 200, "2026-07-15", "credit")
	insertTxn(t, pool, userID, "daily", "Jul16 credit", 400, "2026-07-16", "credit")
	insertTxn(t, pool, userID, "essential", "Jul31 credit", 800, "2026-07-31", "credit")

	// A settlement clearing the Jul15 credit — must NOT change credit usage.
	settlement := insertTxn(t, pool, userID, "flexible", "Card payment", 200, "2026-07-20", "settlement")
	if _, err := pool.Exec(ctx, `INSERT INTO settlement_links (settlement_id, credit_id) VALUES ($1, $2)`, settlement, settled); err != nil {
		t.Fatalf("insert settlement link: %v", err)
	}

	// Noise that must be excluded: cash, income, and settlement rows.
	insertTxn(t, pool, userID, "essential", "Jul cash", 5000, "2026-07-10", "cash")
	insertTxn(t, pool, userID, "income", "Jul salary", 90000, "2026-07-01", "cash")
}

func getCreditTransactions(t *testing.T, srv *Server, token, path string) CreditTransactionsDTO {
	t.Helper()
	rr := apiRequest(t, srv, token, http.MethodGet, path, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("%s status = %d body = %s", path, rr.Code, rr.Body.String())
	}
	var out CreditTransactionsDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode credit transactions: %v", err)
	}
	return out
}

// jsonHasNullField reports whether the top-level JSON object has the given key
// present with an explicit null value (distinguishing null from omitted).
func jsonHasNullField(t *testing.T, body []byte, field string) bool {
	t.Helper()
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	v, ok := raw[field]
	return ok && string(v) == "null"
}
