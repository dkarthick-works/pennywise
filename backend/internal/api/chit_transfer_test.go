package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/auth"
)

const chitTransferFixture = `{
  "format": "pennywise-chits",
  "version": 1,
  "chits": [
    {
      "name": "Office Chit",
      "organizer": "Ramesh",
      "chit_value": 100000,
      "expected_monthly": 5000,
      "total_installments": 20,
      "start_month": "2026-07-01",
      "installments": [
        {"paid_on": "2026-07-10", "amount": 4800.5, "note": "part payment"}
      ]
    }
  ]
}`

func TestChitTransferArchiveContract(t *testing.T) {
	var archive chitTransferArchive
	if err := json.Unmarshal([]byte(chitTransferFixture), &archive); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	if err := validateAndNormalizeChitArchive(&archive); err != nil {
		t.Fatalf("validate fixture: %v", err)
	}
	if archive.Format != chitArchiveFormat || archive.Version != chitArchiveVersion {
		t.Fatalf("archive identity = %q/%d", archive.Format, archive.Version)
	}
	if got := archive.Chits[0].ChitValue.String(); got != "100000.00" {
		t.Fatalf("chit value = %q, want 100000.00", got)
	}
	if got := archive.Chits[0].Installments[0].Amount.String(); got != "4800.50" {
		t.Fatalf("installment amount = %q, want 4800.50", got)
	}
}

func TestChitTransferArchiveRejectsMissingAndUnknownFields(t *testing.T) {
	var archive chitTransferArchive
	missing := strings.Replace(chitTransferFixture, `"installments": [`, `"extra": true, "installments": [`, 1)
	if err := json.Unmarshal([]byte(missing), &archive); err == nil || !strings.Contains(err.Error(), "unknown archive field") {
		t.Fatalf("unknown field error = %v", err)
	}

	var object map[string]any
	if err := json.Unmarshal([]byte(chitTransferFixture), &object); err != nil {
		t.Fatal(err)
	}
	delete(object["chits"].([]any)[0].(map[string]any), "installments")
	missingBytes, err := json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(missingBytes, &archive); err == nil || !strings.Contains(err.Error(), "installments is required") {
		t.Fatalf("missing installments error = %v", err)
	}
}

func TestChitTransferArchiveRejectsTrailingJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/chits/import", strings.NewReader(chitTransferFixture+"{}"))
	rr := httptest.NewRecorder()
	if _, err := decodeChitTransferArchive(rr, req); err == nil || err.Error() != "invalid request body" {
		t.Fatalf("trailing JSON error = %v", err)
	}
}

func TestChitTransferArchiveRejectsLexicallyInvalidMoney(t *testing.T) {
	tests := []string{"1e2", "1.234", "-1", "0", "9999999999999.00"}
	for _, value := range tests {
		t.Run(value, func(t *testing.T) {
			archive := strings.Replace(chitTransferFixture, "100000", value, 1)
			var decoded chitTransferArchive
			if err := json.Unmarshal([]byte(archive), &decoded); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if err := validateAndNormalizeChitArchive(&decoded); err == nil {
				t.Fatalf("validate(%q) = nil, want error", value)
			}
		})
	}
}

func TestChitTransferArchiveSizeLimit(t *testing.T) {
	body := `{"format":"pennywise-chits","version":1,"chits":[{"name":"` +
		strings.Repeat("x", int(maxChitArchiveBytes)) + `"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/chits/import", strings.NewReader(body))
	rr := httptest.NewRecorder()
	if _, err := decodeChitTransferArchive(rr, req); err == nil || !errors.Is(err, errChitArchiveLimit) {
		t.Fatalf("oversized archive error = %v", err)
	}
}

func TestBuildChitTransferArchiveUsesStableNestedShape(t *testing.T) {
	date, err := parseDate("2026-07-01")
	if err != nil {
		t.Fatal(err)
	}
	parentID := uuid.New()
	parents := []chitTransferParent{{
		ID:                parentID,
		Name:              "Office Chit",
		Organizer:         "Ramesh",
		ChitValue:         floatToNum(100000),
		ExpectedMonthly:   floatToNum(5000),
		TotalInstallments: 20,
		StartMonth:        date,
	}}
	children := []chitTransferChild{{
		ID: uuid.New(), ChitID: parentID, Amount: floatToNum(4800.5), PaidOn: date, Note: "paid",
	}}
	archive, err := buildChitTransferArchive(parents, children)
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.Chits) != 1 || len(archive.Chits[0].Installments) != 1 {
		t.Fatalf("archive shape = %+v", archive)
	}
	if got := archive.Chits[0].Installments[0].Amount.String(); got != "4800.50" {
		t.Fatalf("amount = %q, want 4800.50", got)
	}
}

func TestChitTransferEmptyExportArchive(t *testing.T) {
	archive := chitTransferArchive{
		Format: chitArchiveFormat, Version: chitArchiveVersion, Chits: []chitTransferChit{},
	}
	var encoded bytes.Buffer
	if err := json.NewEncoder(&encoded).Encode(archive); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(encoded.String(), `"chits":[]`) {
		t.Fatalf("empty archive = %s", encoded.String())
	}
}

func TestChitTransferRoundTripAndDuplicateImport(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	body := validChitBody()
	body["total_installments"] = 2
	original := createChit(t, srv, token, body)
	addInstallment(t, srv, token, original.ID, 4800.5, "2026-07-10", http.StatusCreated)
	addInstallment(t, srv, token, original.ID, 5000, "2026-08-10", http.StatusCreated)

	exported := apiRequest(t, srv, token, http.MethodGet, "/api/chits/export", nil)
	if exported.Code != http.StatusOK {
		t.Fatalf("export status = %d body = %s", exported.Code, exported.Body.String())
	}
	if got := exported.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("content type = %q", got)
	}
	if !strings.HasPrefix(exported.Header().Get("Content-Disposition"), `attachment; filename="pennywise-chits-`) {
		t.Fatalf("content disposition = %q", exported.Header().Get("Content-Disposition"))
	}

	var archive chitTransferArchive
	if err := json.Unmarshal(exported.Body.Bytes(), &archive); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if len(archive.Chits) != 1 || len(archive.Chits[0].Installments) != 2 {
		t.Fatalf("export shape = %+v", archive)
	}

	imported := apiRequest(t, srv, token, http.MethodPost, "/api/chits/import", archive)
	if imported.Code != http.StatusCreated {
		t.Fatalf("import status = %d body = %s", imported.Code, imported.Body.String())
	}
	var result chitTransferResult
	if err := json.Unmarshal(imported.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode import result: %v", err)
	}
	if result.ImportedChits != 1 || result.ImportedInstallments != 2 {
		t.Fatalf("import result = %+v", result)
	}

	rr := apiRequest(t, srv, token, http.MethodGet, "/api/chits", nil)
	var list []ChitSummaryDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("chits after import = %d, want 2", len(list))
	}
	for _, chit := range list {
		if chit.ID == original.ID {
			continue
		}
		detail := getChitDetail(t, srv, token, chit.ID)
		if detail.Name != original.Name || len(detail.Installments) != 2 || detail.Status != "completed" {
			t.Fatalf("round-tripped chit = %+v", detail)
		}
	}

	repeated := apiRequest(t, srv, token, http.MethodPost, "/api/chits/import", archive)
	if repeated.Code != http.StatusCreated {
		t.Fatalf("repeated import status = %d body = %s", repeated.Code, repeated.Body.String())
	}
	rr = apiRequest(t, srv, token, http.MethodGet, "/api/chits", nil)
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode repeated list: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("chits after repeated import = %d, want 3", len(list))
	}
}

func TestChitTransferSingleExportAndOwnerIsolation(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	original := createChit(t, srv, token, validChitBody())
	single := apiRequest(t, srv, token, http.MethodGet, "/api/chits/export?chit_id="+original.ID, nil)
	if single.Code != http.StatusOK {
		t.Fatalf("single export status = %d body = %s", single.Code, single.Body.String())
	}
	wantPrefix := `attachment; filename="pennywise-chit-` + original.ID + `-`
	if !strings.HasPrefix(single.Header().Get("Content-Disposition"), wantPrefix) {
		t.Fatalf("single content disposition = %q", single.Header().Get("Content-Disposition"))
	}

	otherID := uuid.New()
	if err := srv.provisionUser(context.Background(), auth.Identity{UserID: otherID, Email: "other-chit-transfer@example.com"}); err != nil {
		t.Fatalf("provision second user: %v", err)
	}
	otherToken := signedTestToken(t, otherID)
	foreign := apiRequest(t, srv, otherToken, http.MethodGet, "/api/chits/export?chit_id="+original.ID, nil)
	if foreign.Code != http.StatusNotFound || foreign.Body.String() != "{\"error\":\"chit not found\"}\n" {
		t.Fatalf("foreign export = %d %s", foreign.Code, foreign.Body.String())
	}

	invalid := apiRequest(t, srv, token, http.MethodGet, "/api/chits/export?chit_id=not-a-uuid", nil)
	if invalid.Code != http.StatusNotFound {
		t.Fatalf("invalid single export status = %d", invalid.Code)
	}
}

func TestChitTransferRejectsInvalidRawMoney(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	raw := json.RawMessage([]byte(`{"format":"pennywise-chits","version":1,"chits":[{"name":"A","organizer":"B","chit_value":1e2,"expected_monthly":1.230,"total_installments":1,"start_month":"2026-07-01","installments":[]}]}`))
	rr := apiRequest(t, srv, token, http.MethodPost, "/api/chits/import", raw)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid raw money status = %d body = %s", rr.Code, rr.Body.String())
	}
	if rr.Body.String() != "{\"error\":\"chits[0].chit_value: must be a positive decimal with at most two fractional digits\"}\n" {
		t.Fatalf("invalid raw money body = %s", rr.Body.String())
	}
}

func TestChitTransferMaximumBoundaryPerformance(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	archive := chitTransferArchive{
		Format: chitArchiveFormat, Version: chitArchiveVersion,
		Chits: make([]chitTransferChit, 0, maxChitArchiveChits),
	}
	for chitIndex := 0; chitIndex < int(maxChitArchiveChits); chitIndex++ {
		installments := make([]chitTransferInstallment, 0, 20)
		for installmentIndex := 0; installmentIndex < 20; installmentIndex++ {
			installments = append(installments, chitTransferInstallment{
				PaidOn: "2026-07-10",
				Amount: json.Number("1.00"),
				Note:   "",
			})
		}
		archive.Chits = append(archive.Chits, chitTransferChit{
			Name:              "Boundary chit",
			Organizer:         "Boundary organizer",
			ChitValue:         json.Number("100.00"),
			ExpectedMonthly:   json.Number("1.00"),
			TotalInstallments: 20,
			StartMonth:        "2026-07-01",
			Installments:      installments,
		})
		_ = chitIndex
	}

	started := time.Now()
	rr := apiRequest(t, srv, token, http.MethodPost, "/api/chits/import", archive)
	elapsed := time.Since(started)
	if rr.Code != http.StatusCreated {
		t.Fatalf("maximum import status = %d body = %s", rr.Code, rr.Body.String())
	}
	if elapsed >= 5*time.Second {
		t.Fatalf("maximum import took %s, want under 5s", elapsed)
	}
}
