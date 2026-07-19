package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/auth"
)

// setThreshold PUTs the credit spending threshold and asserts the resulting DTO.
func setThreshold(t *testing.T, srv *Server, token string, body any, wantStatus int) SettingsDTO {
	t.Helper()
	rr := apiRequest(t, srv, token, http.MethodPut, "/api/settings/credit-spending-threshold", body)
	if rr.Code != wantStatus {
		t.Fatalf("PUT credit-spending-threshold status = %d body = %s, want %d", rr.Code, rr.Body.String(), wantStatus)
	}
	var out SettingsDTO
	if wantStatus == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode settings: %v", err)
		}
	}
	return out
}

// raw builds a request body that is serialized verbatim, so decimal literals
// like 100.50 or 1e3 are not rewritten by Go's number formatting before they
// reach the handler's lexical validation.
func raw(s string) json.RawMessage { return json.RawMessage(s) }

func TestUpdateCreditSpendingThreshold(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	// Unset by default, and serialized as an explicit null (never omitted).
	rr := apiRequest(t, srv, token, http.MethodGet, "/api/settings", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get settings status = %d body = %s", rr.Code, rr.Body.String())
	}
	if !jsonHasNullField(t, rr.Body.Bytes(), "credit_spending_threshold") {
		t.Fatalf("credit_spending_threshold not explicit null: %s", rr.Body.String())
	}
	var got SettingsDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	if got.CreditSpendingThreshold != nil {
		t.Fatalf("default threshold = %v, want nil", *got.CreditSpendingThreshold)
	}

	// Set.
	out := setThreshold(t, srv, token, map[string]any{"credit_spending_threshold": 25000}, http.StatusOK)
	if out.CreditSpendingThreshold == nil || *out.CreditSpendingThreshold != 25000 {
		t.Fatalf("set threshold = %v, want 25000", out.CreditSpendingThreshold)
	}

	// Replace with a two-decimal value.
	out = setThreshold(t, srv, token, raw(`{"credit_spending_threshold":30000.50}`), http.StatusOK)
	if out.CreditSpendingThreshold == nil || *out.CreditSpendingThreshold != 30000.50 {
		t.Fatalf("replace threshold = %v, want 30000.50", out.CreditSpendingThreshold)
	}

	// Get reflects the stored value.
	rr = apiRequest(t, srv, token, http.MethodGet, "/api/settings", nil)
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	if got.CreditSpendingThreshold == nil || *got.CreditSpendingThreshold != 30000.50 {
		t.Fatalf("get threshold = %v, want 30000.50", got.CreditSpendingThreshold)
	}

	// Clear with explicit null.
	out = setThreshold(t, srv, token, map[string]any{"credit_spending_threshold": nil}, http.StatusOK)
	if out.CreditSpendingThreshold != nil {
		t.Fatalf("cleared threshold = %v, want nil", *out.CreditSpendingThreshold)
	}

	// Max value is accepted.
	out = setThreshold(t, srv, token, raw(`{"credit_spending_threshold":999999999999.99}`), http.StatusOK)
	if out.CreditSpendingThreshold == nil || *out.CreditSpendingThreshold != 999999999999.99 {
		t.Fatalf("max threshold = %v, want 999999999999.99", out.CreditSpendingThreshold)
	}
}

func TestUpdateCreditSpendingThresholdValidation(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	cases := []struct {
		name string
		body any
	}{
		{"missing property", map[string]any{}},
		{"unknown field", map[string]any{"nope": 1}},
		{"zero", raw(`{"credit_spending_threshold":0}`)},
		{"negative", raw(`{"credit_spending_threshold":-5}`)},
		{"three decimals", raw(`{"credit_spending_threshold":100.501}`)},
		{"exponent lower", raw(`{"credit_spending_threshold":1e3}`)},
		{"exponent upper", raw(`{"credit_spending_threshold":1E3}`)},
		{"string", raw(`{"credit_spending_threshold":"100"}`)},
		{"boolean", raw(`{"credit_spending_threshold":true}`)},
		{"object", raw(`{"credit_spending_threshold":{}}`)},
		{"above max", raw(`{"credit_spending_threshold":1000000000000}`)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			setThreshold(t, srv, token, c.body, http.StatusBadRequest)
		})
	}
}

func TestUpdateCreditSpendingThresholdUserIsolation(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	// First user sets a threshold.
	setThreshold(t, srv, token, map[string]any{"credit_spending_threshold": 12345}, http.StatusOK)

	// A second user is unaffected — their threshold is still unset.
	otherID := uuid.New()
	if err := srv.provisionUser(context.Background(), auth.Identity{UserID: otherID, Email: "iso@example.com"}); err != nil {
		t.Fatalf("provision other user: %v", err)
	}
	otherToken := signedTestToken(t, otherID)

	rr := apiRequest(t, srv, otherToken, http.MethodGet, "/api/settings", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("other get settings status = %d body = %s", rr.Code, rr.Body.String())
	}
	var other SettingsDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &other); err != nil {
		t.Fatalf("decode other settings: %v", err)
	}
	if other.CreditSpendingThreshold != nil {
		t.Fatalf("other user threshold = %v, want nil", *other.CreditSpendingThreshold)
	}
}
