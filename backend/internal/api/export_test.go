package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/db"
)

func TestValidateExportRange(t *testing.T) {
	tests := []struct {
		name    string
		from    string
		to      string
		wantErr string
	}{
		{name: "one month", from: "2026-01-01", to: "2026-01-31"},
		{name: "six month boundary", from: "2026-01-01", to: "2026-06-30"},
		{name: "seven months rejected", from: "2026-01-01", to: "2026-07-01", wantErr: "date range must not exceed 6 months"},
		{name: "inverted dates", from: "2026-02-01", to: "2026-01-31", wantErr: "from date must be before or equal to to date"},
		{name: "bad format", from: "2026-1-01", to: "2026-01-31", wantErr: "from and to must be YYYY-MM-DD"},
		{name: "invalid date", from: "2026-02-30", to: "2026-03-01", wantErr: "from and to must be valid dates"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := validateExportRange(tc.from, tc.to)
			if tc.wantErr == "" && err != nil {
				t.Fatalf("validateExportRange() error = %v, want nil", err)
			}
			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("validateExportRange() error = nil, want %q", tc.wantErr)
				}
				if err.Error() != tc.wantErr {
					t.Fatalf("validateExportRange() error = %q, want %q", err.Error(), tc.wantErr)
				}
			}
		})
	}
}

func TestEnsureExportTransactionsRequiresRows(t *testing.T) {
	if err := ensureExportTransactions(nil); err == nil || err.Error() != noExportRowsMessage {
		t.Fatalf("ensureExportTransactions(nil) = %v, want %q", err, noExportRowsMessage)
	}

	txns := []db.Transaction{{Kind: db.TxnKindSettlement}}
	if err := ensureExportTransactions(txns); err == nil || err.Error() != noExportRowsMessage {
		t.Fatalf("ensureExportTransactions(settlement only) = %v, want %q", err, noExportRowsMessage)
	}
}

func TestExportTransactionRows(t *testing.T) {
	cashID := uuid.New()
	settlementID := uuid.New()
	date, err := parseDate("2026-01-15")
	if err != nil {
		t.Fatal(err)
	}
	txns := []db.Transaction{
		{
			ID:       cashID,
			Section:  db.SectionDaily,
			Category: "Food, lunch",
			Amount:   floatToNum(123.4),
			TxnDate:  date,
			Kind:     db.TxnKindCash,
		},
		{
			ID:       settlementID,
			Section:  db.SectionDaily,
			Category: "Credit card settlement",
			Amount:   floatToNum(123.4),
			TxnDate:  date,
			Kind:     db.TxnKindSettlement,
		},
	}

	rows := exportTransactionRows(txns, "INR")
	if len(rows) != 2 {
		t.Fatalf("rows length = %d, want 2", len(rows))
	}
	wantHeader := []string{"id", "date", "section", "category", "amount", "currency", "kind"}
	for i, want := range wantHeader {
		if rows[0][i] != want {
			t.Fatalf("header[%d] = %q, want %q", i, rows[0][i], want)
		}
	}
	wantRow := []string{cashID.String(), "2026-01-15", "daily", "Food, lunch", "123.40", "INR", "cash"}
	for i, want := range wantRow {
		if rows[1][i] != want {
			t.Fatalf("row[%d] = %q, want %q", i, rows[1][i], want)
		}
	}
}

func TestWriteCSV(t *testing.T) {
	rr := httptest.NewRecorder()
	rows := [][]string{
		{"id", "category", "amount"},
		{"1", "Food, lunch", "123.40"},
	}

	if err := writeCSV(rr, "pennywise-transactions-2026-01-01_2026-01-31.csv", rows); err != nil {
		t.Fatalf("writeCSV() error = %v", err)
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Header().Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Fatalf("content type = %q", got)
	}
	if got := rr.Header().Get("Content-Disposition"); got != `attachment; filename="pennywise-transactions-2026-01-01_2026-01-31.csv"` {
		t.Fatalf("content disposition = %q", got)
	}
	body := rr.Body.String()
	if !strings.HasPrefix(body, "\ufeff") {
		t.Fatalf("body missing UTF-8 BOM: %q", body)
	}
	if !strings.Contains(body, "\"Food, lunch\"") {
		t.Fatalf("body missing quoted category: %q", body)
	}
}
