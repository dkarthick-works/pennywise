package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ledger/backend/internal/config"
	"github.com/ledger/backend/internal/db"
)

func TestValidImportKind(t *testing.T) {
	if !validImportKind("cash") || !validImportKind("credit") {
		t.Fatal("cash and credit should be valid import kinds")
	}
	if validImportKind("settlement") {
		t.Fatal("settlement must not pass validImportKind even though validKind accepts it")
	}
	if validKind("settlement") != true {
		t.Fatal("sanity: validKind(settlement) should be true")
	}
}

func TestValidateImportRow(t *testing.T) {
	tests := []struct {
		name    string
		row     importRowInput
		wantKey string
	}{
		{
			name: "valid cash",
			row:  importRowInput{Date: "2026-01-15", Section: "daily", Category: "Food", Amount: 123.4, Kind: "cash"},
		},
		{
			name: "zero amount allowed",
			row:  importRowInput{Date: "2026-01-01", Section: "essential", Category: "Rent", Amount: 0, Kind: "cash"},
		},
		{
			name:    "settlement rejected",
			row:     importRowInput{Date: "2026-01-15", Section: "daily", Category: "Pay", Amount: 10, Kind: "settlement"},
			wantKey: "kind",
		},
		{
			name:    "negative amount",
			row:     importRowInput{Date: "2026-01-15", Section: "daily", Category: "Food", Amount: -1, Kind: "cash"},
			wantKey: "amount",
		},
		{
			name:    "empty category",
			row:     importRowInput{Date: "20266-01-15", Section: "daily", Category: "  ", Amount: 1, Kind: "cash"},
			wantKey: "category",
		},
		{
			name:    "income credit",
			row:     importRowInput{Date: "2026-01-15", Section: "income", Category: "Salary", Amount: 1, Kind: "credit"},
			wantKey: "kind",
		},
		{
			name:    "bad date",
			row:     importRowInput{Date: "2026-02-30", Section: "daily", Category: "Food", Amount: 1, Kind: "cash"},
			wantKey: "date",
		},
		{
			name:    "bad section",
			row:     importRowInput{Date: "2026-01-15", Section: "misc", Category: "Food", Amount: 1, Kind: "cash"},
			wantKey: "section",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fields := validateImportRow(tc.row)
			if tc.wantKey == "" {
				if len(fields) != 0 {
					t.Fatalf("validateImportRow() = %#v, want no errors", fields)
				}
				return
			}
			if fields[tc.wantKey] == "" {
				t.Fatalf("validateImportRow() = %#v, want error on %q", fields, tc.wantKey)
			}
		})
	}
}

func TestValidateImportRowsRoundTripZeroAmount(t *testing.T) {
	date, err := parseDate("2026-01-01")
	if err != nil {
		t.Fatal(err)
	}
	txns := []db.Transaction{
		{
			ID: uuid.New(), Section: db.SectionEssential, Category: "Rent",
			Amount: floatToNum(0), TxnDate: date, Kind: db.TxnKindCash,
		},
	}
	rows := exportTransactionRows(txns, "INR")
	if len(rows) != 2 {
		t.Fatalf("export rows = %d, want header + 1 data row", len(rows))
	}

	importRows := []importRowInput{{
		Date: rows[1][1], Section: rows[1][2], Category: rows[1][3],
		Amount: 0, Kind: rows[1][6],
	}}
	if errs := validateImportRows(importRows); len(errs) != 0 {
		t.Fatalf("validateImportRows() = %#v, want no errors for zero-amount export row", errs)
	}
}

func TestImportRowCap(t *testing.T) {
	rows := make([]importRowInput, maxImportRows+1)
	for i := range rows {
		rows[i] = importRowInput{
			Date: "2026-01-15", Section: "daily", Category: "Food", Amount: 1, Kind: "cash",
		}
	}
	body, _ := json.Marshal(importRequest{Rows: rows})
	req := httptest.NewRequest(http.MethodPost, "/api/transactions/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// Without auth this would 401; cap check happens after readJSON in handler.
	// Unit-test the cap constant directly:
	if len(rows) <= maxImportRows {
		t.Fatal("test setup should exceed cap")
	}
	if maxImportRows != 2000 {
		t.Fatalf("maxImportRows = %d, want 2000", maxImportRows)
	}
}

func TestImportTransactionsIntegration(t *testing.T) {
	rawURL := os.Getenv("PENNYWISE_TEST_DATABASE_URL")
	if rawURL == "" {
		t.Skip("set PENNYWISE_TEST_DATABASE_URL to run import integration tests")
	}

	ctx := context.Background()
	migrateTestDB(t, rawURL)

	pool, err := pgxpool.New(ctx, rawURL)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(func() { pool.Close() })

	userID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (id, email, display_name) VALUES ($1, 'import@test', 'Import Test');
		INSERT INTO user_settings (user_id) VALUES ($1);
	`, userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	cfg := config.Config{
		JWTSecret:      categoryAPITestSecret,
		JWTUserClaim:   "user_id",
		JWTEmailClaim:  "email",
		CORSOrigins:    []string{"*"},
	}
	srv, err := NewServer(cfg, pool)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID.String(),
		"email":   "import@test",
	})
	tokenStr, err := token.SignedString([]byte(categoryAPITestSecret))
	if err != nil {
		t.Fatal(err)
	}

	importBody := importRequest{Rows: []importRowInput{
		{Date: "2026-01-15", Section: "daily", Category: "Food, lunch", Amount: 123.4, Kind: "cash"},
		{Date: "2026-02-01", Section: "income", Category: "Salary", Amount: 0, Kind: "cash"},
	}}
	payload, _ := json.Marshal(importBody)

	req := httptest.NewRequest(http.MethodPost, "/api/transactions/import", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()
	srv.Router().ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}

	var result importResult
	if err := json.NewDecoder(rr.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Imported != 2 {
		t.Fatalf("imported = %d, want 2", result.Imported)
	}
	if len(result.Months) != 2 {
		t.Fatalf("months = %#v, want two distinct months", result.Months)
	}

	// Row cap via HTTP
	over := make([]importRowInput, maxImportRows+1)
	for i := range over {
		over[i] = importRowInput{Date: "2026-01-15", Section: "daily", Category: "X", Amount: 1, Kind: "cash"}
	}
	capPayload, _ := json.Marshal(importRequest{Rows: over})
	capReq := httptest.NewRequest(http.MethodPost, "/api/transactions/import", bytes.NewReader(capPayload))
	capReq.Header.Set("Content-Type", "application/json")
	capReq.Header.Set("Authorization", "Bearer "+tokenStr)
	capRR := httptest.NewRecorder()
	srv.Router().ServeHTTP(capRR, capReq)
	if capRR.Code != http.StatusBadRequest {
		t.Fatalf("cap status = %d, want 400", capRR.Code)
	}
	var capErr map[string]string
	if err := json.NewDecoder(capRR.Body).Decode(&capErr); err != nil {
		t.Fatal(err)
	}
	if capErr["error"] != importRowCapMessage {
		t.Fatalf("cap error = %q, want %q", capErr["error"], importRowCapMessage)
	}

	// Settlement rejected
	settlePayload, _ := json.Marshal(importRequest{Rows: []importRowInput{
		{Date: "2026-01-15", Section: "daily", Category: "Pay", Amount: 10, Kind: "settlement"},
	}})
	settleReq := httptest.NewRequest(http.MethodPost, "/api/transactions/import", bytes.NewReader(settlePayload))
	settleReq.Header.Set("Content-Type", "application/json")
	settleReq.Header.Set("Authorization", "Bearer "+tokenStr)
	settleRR := httptest.NewRecorder()
	srv.Router().ServeHTTP(settleRR, settleReq)
	if settleRR.Code != http.StatusBadRequest {
		t.Fatalf("settlement status = %d, want 400", settleRR.Code)
	}
}
