package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ledger/backend/internal/config"
	"github.com/ledger/backend/internal/money"
	"github.com/ledger/backend/internal/transactionparser"
)

type fakeTransactionParser struct {
	result transactionparser.ParseResult
	err    error
	input  transactionparser.ParseInput
}

func (f *fakeTransactionParser) Parse(_ context.Context, input transactionparser.ParseInput) (transactionparser.ParseResult, error) {
	f.input = input
	return f.result, f.err
}

func TestHandleParseTransactionsCompleteAndPartial(t *testing.T) {
	section, category, amount, date, kind := "daily", "Lunch", money.Number("500.25"), "2026-08-26", "cash"
	partialCategory := "Petrol"
	parser := &fakeTransactionParser{result: transactionparser.ParseResult{
		Transactions: []transactionparser.Draft{
			{Section: &section, Category: &category, Amount: &amount, Date: &date, Kind: &kind, Issues: []transactionparser.Issue{
				{Field: "amount", Code: "missing_amount"},
				{Field: "kind", Code: "unsupported_settlement"},
			}},
			{Category: &partialCategory, Issues: []transactionparser.Issue{
				{Field: "amount", Code: "missing_amount"},
				{Field: "date", Code: "missing_date"},
			}},
		},
		Usage: transactionparser.Usage{Model: "test", TotalTokens: 20},
	}}
	server := &Server{transactionParser: parser, aiSlots: make(chan struct{}, 1)}
	response := callParseHandler(t, server, `{"text":"Lunch 500 and petrol","reference_date":"2026-08-26"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	var body parseTransactionsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Transactions) != 2 || !body.Transactions[0].Ready {
		t.Fatalf("transactions = %#v", body.Transactions)
	}
	partial := body.Transactions[1]
	if partial.Ready || partial.Amount != nil || partial.Date == nil || *partial.Date != "2026-08-26" || partial.Kind == nil || *partial.Kind != "cash" {
		t.Fatalf("partial = %#v", partial)
	}
	if !hasIssueCode(partial.Issues, "missing_amount") || !hasIssueCode(partial.Issues, "missing_section") {
		t.Fatalf("partial issues = %#v", partial.Issues)
	}
	if hasIssueCode(partial.Issues, "missing_date") || hasIssueCode(partial.Issues, "missing_kind") {
		t.Fatalf("defaulted fields retained missing issues: %#v", partial.Issues)
	}
	if parser.input.Text != "Lunch 500 and petrol" || parser.input.ReferenceDate != "2026-08-26" {
		t.Fatalf("parser input = %#v", parser.input)
	}
}

func TestHandleParseTransactionsNoPreview(t *testing.T) {
	category := "Card payment"
	tests := []struct {
		name   string
		result transactionparser.ParseResult
		err    error
	}{
		{name: "no candidates", err: transactionparser.ErrNoTransactions},
		{name: "empty values", result: transactionparser.ParseResult{Transactions: []transactionparser.Draft{{}}}},
		{name: "settlement only", result: transactionparser.ParseResult{Transactions: []transactionparser.Draft{{
			Category: &category,
			Issues:   []transactionparser.Issue{{Field: "kind", Code: "unsupported_settlement"}},
		}}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := &Server{
				transactionParser: &fakeTransactionParser{result: tc.result, err: tc.err},
				aiSlots:           make(chan struct{}, 1),
			}
			response := callParseHandler(t, server, `{"text":"paid my card","reference_date":"2026-08-26"}`)
			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestHandleParseTransactionsRequestAndProviderErrors(t *testing.T) {
	tests := []struct {
		name string
		body string
		err  error
		want int
	}{
		{name: "empty text", body: `{"text":" ","reference_date":"2026-08-26"}`, want: http.StatusBadRequest},
		{name: "bad reference date", body: `{"text":"Lunch 10","reference_date":"2026-02-30"}`, want: http.StatusBadRequest},
		{name: "unknown field", body: `{"text":"Lunch 10","reference_date":"2026-08-26","save":true}`, want: http.StatusBadRequest},
		{name: "rate limited", body: `{"text":"Lunch 10","reference_date":"2026-08-26"}`, err: transactionparser.ErrRateLimited, want: http.StatusTooManyRequests},
		{name: "timeout", body: `{"text":"Lunch 10","reference_date":"2026-08-26"}`, err: transactionparser.ErrTimeout, want: http.StatusGatewayTimeout},
		{name: "invalid response", body: `{"text":"Lunch 10","reference_date":"2026-08-26"}`, err: transactionparser.ErrInvalidResponse, want: http.StatusBadGateway},
		{name: "unavailable", body: `{"text":"Lunch 10","reference_date":"2026-08-26"}`, err: errors.New("secret upstream details"), want: http.StatusServiceUnavailable},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := &Server{
				transactionParser: &fakeTransactionParser{err: tc.err},
				aiSlots:           make(chan struct{}, 1),
			}
			response := callParseHandler(t, server, tc.body)
			if response.Code != tc.want {
				t.Fatalf("status = %d want=%d body=%s", response.Code, tc.want, response.Body.String())
			}
			if bytes.Contains(response.Body.Bytes(), []byte("secret upstream details")) {
				t.Fatal("raw provider error leaked")
			}
		})
	}
}

func TestHandleParseTransactionsCapacityLimit(t *testing.T) {
	slots := make(chan struct{}, 1)
	slots <- struct{}{}
	server := &Server{
		transactionParser: &fakeTransactionParser{},
		aiSlots:           slots,
	}
	response := callParseHandler(t, server, `{"text":"Lunch 10","reference_date":"2026-08-26"}`)
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}

func TestParseRouteRequiresLogin(t *testing.T) {
	server, err := NewServer(config.Config{
		JWTSecret: "test-secret", JWTUserClaim: "sub", JWTEmailClaim: "email",
		GoauthBaseURL: "http://localhost:8090", CORSOrigins: []string{"http://localhost"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/transactions/parse", bytes.NewBufferString(`{"text":"Lunch 10","reference_date":"2026-08-26"}`))
	response := httptest.NewRecorder()
	server.Router().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}

func TestParseDoesNotWriteAndPreviewCanBeCreatedIntegration(t *testing.T) {
	server, pool, token, userID := setupCategoryAPITest(t)
	section, category, amount, date, kind := "daily", "Lunch", money.Number("500.25"), "2026-08-26", "cash"
	server.transactionParser = &fakeTransactionParser{result: transactionparser.ParseResult{
		Transactions: []transactionparser.Draft{{
			Section: &section, Category: &category, Amount: &amount, Date: &date, Kind: &kind,
		}},
	}}

	parseResponse := apiRequest(t, server, token, http.MethodPost, "/api/transactions/parse", map[string]string{
		"text": "Spent ₹500.25 for lunch today", "reference_date": "2026-08-26",
	})
	if parseResponse.Code != http.StatusOK {
		t.Fatalf("parse status = %d body=%s", parseResponse.Code, parseResponse.Body.String())
	}
	var count int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM transactions WHERE user_id=$1", userID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("parse wrote %d transactions", count)
	}

	createResponse := apiRequest(t, server, token, http.MethodPost, "/api/transactions", map[string]any{
		"section": section, "category": category, "amount": amount, "date": date, "kind": kind,
	})
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", createResponse.Code, createResponse.Body.String())
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM transactions WHERE user_id=$1", userID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("create wrote %d transactions, want 1", count)
	}
}

func callParseHandler(t *testing.T, server *Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/transactions/parse", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.handleParseTransactions(response, request)
	return response
}
