package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/auth"
	"github.com/ledger/backend/internal/db"
)

const lentTransferFixture = `{
  "type": "pennywise-lents",
  "version": 1,
  "exported_at": "2026-08-16T00:00:00Z",
  "lents": [
    {
      "source_id": "11111111-1111-4111-8111-111111111111",
      "counterparty": "Ravi",
      "amount": "5000",
      "lent_on": "2026-06-01",
      "due_on": null,
      "note": "",
      "repayments": [
        {
          "source_id": "22222222-2222-4222-8222-222222222222",
          "amount": "2000.5",
          "repaid_on": "2026-06-15",
          "note": "part payment"
        }
      ]
    }
  ]
}`

func TestLentTransferArchiveContract(t *testing.T) {
	var archive lentTransferArchive
	if err := json.Unmarshal([]byte(lentTransferFixture), &archive); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	if err := validateAndNormalizeLentArchive(&archive); err != nil {
		t.Fatalf("validate fixture: %v", err)
	}
	if archive.Lents[0].Amount != "5000.00" || archive.Lents[0].Repayments[0].Amount != "2000.50" {
		t.Fatalf("archive amounts were not normalized: %+v", archive.Lents[0])
	}
	if archive.Lents[0].DueOn != nil {
		t.Fatalf("due_on = %v, want nil", *archive.Lents[0].DueOn)
	}

	var missingDue map[string]any
	if err := json.Unmarshal([]byte(lentTransferFixture), &missingDue); err != nil {
		t.Fatal(err)
	}
	delete(missingDue["lents"].([]any)[0].(map[string]any), "due_on")
	missingBytes, err := json.Marshal(missingDue)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(missingBytes, &archive); err == nil || !strings.Contains(err.Error(), "due_on is required") {
		t.Fatalf("missing due_on error = %v", err)
	}

	withUnknown := strings.Replace(lentTransferFixture, `"lents": [`, `"extra": true, "lents": [`, 1)
	if err := json.Unmarshal([]byte(withUnknown), &archive); err == nil || !strings.Contains(err.Error(), "unknown archive field") {
		t.Fatalf("unknown field error = %v", err)
	}
}

func TestDecodeLentTransferArchiveRejectsTrailingJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/lents/import", strings.NewReader(lentTransferFixture+"{}"))
	rr := httptest.NewRecorder()
	if _, err := decodeLentTransferArchive(rr, req); err == nil || !strings.Contains(err.Error(), "trailing JSON") {
		t.Fatalf("trailing JSON error = %v", err)
	}
}

func TestDecodeLentTransferArchivePreservesSizeLimit(t *testing.T) {
	body := `{"type":"pennywise-lents","version":1,"exported_at":"2026-08-16T00:00:00Z","lents":[{"source_id":"11111111-1111-4111-8111-111111111111","counterparty":"` +
		strings.Repeat("x", int(maxLentArchiveBytes)) + `"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/lents/import", strings.NewReader(body))
	rr := httptest.NewRecorder()
	if _, err := decodeLentTransferArchive(rr, req); err == nil || !errors.Is(err, errLentArchiveLimit) {
		t.Fatalf("oversized archive error = %v", err)
	}
}

func TestLentTransferMoneyValidation(t *testing.T) {
	tests := []struct {
		value   string
		want    int64
		wantErr bool
	}{
		{"1", 100, false},
		{"1.2", 120, false},
		{"999999999999.99", maxLentArchiveCents, false},
		{"0.01", 1, false},
		{"0", 0, true},
		{"1.234", 0, true},
		{"999999999999.999", 0, true},
		{"1000000000000.00", 0, true},
		{"1e3", 0, true},
	}
	for _, tc := range tests {
		t.Run(tc.value, func(t *testing.T) {
			got, err := parseLentArchiveMoney(tc.value)
			if (err != nil) != tc.wantErr || (!tc.wantErr && got != tc.want) {
				t.Fatalf("parseLentArchiveMoney(%q) = %d, %v; want %d, error=%v", tc.value, got, err, tc.want, tc.wantErr)
			}
		})
	}
}

func TestBuildLentTransferArchiveUsesStableNestedShape(t *testing.T) {
	date, err := parseDate("2026-06-01")
	if err != nil {
		t.Fatal(err)
	}
	parentID := uuid.New()
	repaymentID := uuid.New()
	parents := []db.ListLentsForTransferRow{{
		ID:           parentID,
		Counterparty: "Ravi",
		Amount:       floatToNum(5000),
		LentOn:       date,
		DueOn:        pgtype.Date{},
		Note:         "",
	}}
	repayments := []db.ListRepaymentsForTransferRow{{
		ID:       repaymentID,
		LentID:   parentID,
		Amount:   floatToNum(2000.5),
		RepaidOn: date,
		Note:     "paid",
	}}

	archive, err := buildLentTransferArchive(parents, repayments)
	if err != nil {
		t.Fatal(err)
	}
	if archive.Type != lentArchiveType || archive.Version != lentArchiveVersion {
		t.Fatalf("archive identity = %q/%d", archive.Type, archive.Version)
	}
	if len(archive.Lents) != 1 || archive.Lents[0].DueOn != nil {
		t.Fatalf("archive parent = %+v", archive.Lents)
	}
	if got := archive.Lents[0].Repayments[0].Amount; got != "2000.50" {
		t.Fatalf("repayment amount = %q, want 2000.50", got)
	}
}

func TestLentTransferRoundTrip(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	original := createLent(t, srv, token, map[string]any{
		"counterparty": "Ravi",
		"amount":       5000,
		"lent_on":      "2026-06-01",
		"note":         "bike repair",
	})
	addRepayment(t, srv, token, original.ID, 2000, "2026-06-15", http.StatusCreated)
	addRepayment(t, srv, token, original.ID, 3000, "2026-06-20", http.StatusCreated)

	exported := apiRequest(t, srv, token, http.MethodGet, "/api/lents/export", nil)
	if exported.Code != http.StatusOK {
		t.Fatalf("export status = %d body = %s", exported.Code, exported.Body.String())
	}
	if got := exported.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("content type = %q", got)
	}
	if got := exported.Header().Get("Content-Disposition"); got != `attachment; filename="pennywise-lents-v1.json"` {
		t.Fatalf("content disposition = %q", got)
	}

	var archive lentTransferArchive
	if err := json.Unmarshal(exported.Body.Bytes(), &archive); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if len(archive.Lents) != 1 || len(archive.Lents[0].Repayments) != 2 {
		t.Fatalf("export shape = %+v", archive)
	}

	imported := apiRequest(t, srv, token, http.MethodPost, "/api/lents/import", archive)
	if imported.Code != http.StatusCreated {
		t.Fatalf("import status = %d body = %s", imported.Code, imported.Body.String())
	}
	var result lentTransferResult
	if err := json.Unmarshal(imported.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode import result: %v", err)
	}
	if result.ImportedLents != 1 || result.ImportedRepayments != 2 {
		t.Fatalf("import result = %+v", result)
	}

	lents := listLents(t, srv, token, "all")
	if len(lents) != 2 {
		t.Fatalf("lents after import = %d, want 2", len(lents))
	}
	for _, lent := range lents {
		if lent.ID == original.ID {
			continue
		}
		roundTrip := getLent(t, srv, token, lent.ID)
		if roundTrip.Counterparty != "Ravi" || roundTrip.Outstanding != 0 || roundTrip.Status != "settled" || len(roundTrip.Repayments) != 2 {
			t.Fatalf("round-tripped lent = %+v", roundTrip)
		}
		return
	}
	t.Fatal("import did not create a new lent ID")
}

func TestLentTransferEmptyExportIsValidArchive(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	exported := apiRequest(t, srv, token, http.MethodGet, "/api/lents/export", nil)
	if exported.Code != http.StatusOK {
		t.Fatalf("export status = %d body = %s", exported.Code, exported.Body.String())
	}
	var archive lentTransferArchive
	if err := json.Unmarshal(exported.Body.Bytes(), &archive); err != nil {
		t.Fatalf("decode empty export: %v", err)
	}
	if len(archive.Lents) != 0 {
		t.Fatalf("empty export lents = %d", len(archive.Lents))
	}
}

func TestLentTransferImportIsOwnerScoped(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	original := createLent(t, srv, token, map[string]any{
		"counterparty": "Ravi",
		"amount":       5000,
		"lent_on":      "2026-06-01",
	})
	exported := apiRequest(t, srv, token, http.MethodGet, "/api/lents/export", nil)
	if exported.Code != http.StatusOK {
		t.Fatalf("export status = %d body = %s", exported.Code, exported.Body.String())
	}
	var archive lentTransferArchive
	if err := json.Unmarshal(exported.Body.Bytes(), &archive); err != nil {
		t.Fatal(err)
	}

	otherID := uuid.New()
	if err := srv.provisionUser(context.Background(), auth.Identity{UserID: otherID, Email: "lent-import@example.com"}); err != nil {
		t.Fatal(err)
	}
	otherToken := signedTestToken(t, otherID)
	imported := apiRequest(t, srv, otherToken, http.MethodPost, "/api/lents/import", archive)
	if imported.Code != http.StatusCreated {
		t.Fatalf("other-user import status = %d body = %s", imported.Code, imported.Body.String())
	}

	if got := listLents(t, srv, token, "all"); len(got) != 1 || got[0].ID != original.ID {
		t.Fatalf("owner lents after other-user import = %+v", got)
	}
	otherLents := listLents(t, srv, otherToken, "all")
	if len(otherLents) != 1 || otherLents[0].ID == original.ID {
		t.Fatalf("other-user lents = %+v", otherLents)
	}
}
