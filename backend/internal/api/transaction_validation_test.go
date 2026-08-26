package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ledger/backend/internal/money"
)

func TestDecimalToNumeric(t *testing.T) {
	valid := map[string]string{
		"0":               "0",
		"123.40":          "123.4",
		"1e2":             "100",
		"1e-2":            "0.01",
		"999999999999.99": "999999999999.99",
	}
	for raw, want := range valid {
		t.Run("valid "+raw, func(t *testing.T) {
			number, err := decimalToNumeric(money.Number(raw))
			if err != nil {
				t.Fatal(err)
			}
			if got := numericToJSONNumber(number).String(); got != want {
				t.Fatalf("number = %s, want %s", got, want)
			}
		})
	}

	for _, raw := range []string{"-1", "1.001", "1e-3", "1000000000000", "1e1001"} {
		t.Run("invalid "+raw, func(t *testing.T) {
			if _, err := decimalToNumeric(money.Number(raw)); err == nil {
				t.Fatalf("%s should be rejected", raw)
			}
		})
	}
}

func TestValidateTransactionValues(t *testing.T) {
	section, category, amount, date, kind := "income", " Salary ", money.Number("10.00"), "2026-08-26", "credit"
	issues := validateTransactionValues(transactionValues{
		Section: &section, Category: &category, Amount: &amount, Date: &date, Kind: &kind,
	}, true, true)
	if !hasIssueCode(issues, "invalid_income_kind") {
		t.Fatalf("issues = %#v, want invalid_income_kind", issues)
	}

	kind = "cash"
	issues = validateTransactionValues(transactionValues{
		Section: &section, Category: &category, Amount: &amount, Date: &date, Kind: &kind,
	}, true, true)
	if len(issues) != 0 {
		t.Fatalf("valid transaction issues = %#v", issues)
	}
}

func TestValidateTransactionValuesMissingFields(t *testing.T) {
	issues := validateTransactionValues(transactionValues{}, true, false)
	for _, code := range []string{"missing_section", "missing_category", "missing_amount", "missing_date", "missing_kind"} {
		if !hasIssueCode(issues, code) {
			t.Fatalf("issues = %#v, want %s", issues, code)
		}
	}
}

func TestTransactionAmountJSONNumberCompatibility(t *testing.T) {
	tests := []struct {
		name string
		body string
		dst  any
	}{
		{
			name: "create", body: `{"section":"daily","category":"Lunch","amount":500.25,"date":"2026-08-26","kind":"cash"}`,
			dst: &txnInput{},
		},
		{
			name: "patch", body: `{"amount":5e2}`,
			dst: &txnPatchInput{},
		},
		{
			name: "import", body: `{"rows":[{"section":"daily","category":"Lunch","amount":500.25,"date":"2026-08-26","kind":"cash"}]}`,
			dst: &importRequest{},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(tc.body))
			if err := readJSON(request, tc.dst); err != nil {
				t.Fatalf("numeric client body rejected: %v", err)
			}
			switch value := tc.dst.(type) {
			case *txnInput:
				if value.Amount.String() != "500.25" {
					t.Fatalf("create amount = %q", value.Amount)
				}
			case *txnPatchInput:
				if value.Amount == nil || value.Amount.String() != "5e2" {
					t.Fatalf("patch amount = %#v", value.Amount)
				}
			case *importRequest:
				if len(value.Rows) != 1 || value.Rows[0].Amount.String() != "500.25" {
					t.Fatalf("import rows = %#v", value.Rows)
				}
			}
		})
	}

	request := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"section":"daily","category":"Lunch","amount":"500.25","date":"2026-08-26","kind":"cash"}`))
	if err := readJSON(request, &txnInput{}); err == nil {
		t.Fatal("string amount should remain invalid")
	}
}
