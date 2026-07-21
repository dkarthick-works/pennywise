package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/auth"
)

func validChitBody() map[string]any {
	return map[string]any{
		"name":               "Office Chit A",
		"organizer":          "Ramesh",
		"chit_value":         100000,
		"expected_monthly":   5000,
		"total_installments": 20,
		"start_month":        "2026-07-01",
	}
}

func createChit(t *testing.T, srv *Server, token string, body map[string]any) ChitSummaryDTO {
	t.Helper()
	rr := apiRequest(t, srv, token, http.MethodPost, "/api/chits", body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create chit status = %d body = %s", rr.Code, rr.Body.String())
	}
	var out ChitSummaryDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode chit: %v", err)
	}
	return out
}

func getChitDetail(t *testing.T, srv *Server, token, id string) ChitDetailDTO {
	t.Helper()
	rr := apiRequest(t, srv, token, http.MethodGet, "/api/chits/"+id, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get chit status = %d body = %s", rr.Code, rr.Body.String())
	}
	var out ChitDetailDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode detail: %v", err)
	}
	return out
}

func addInstallment(t *testing.T, srv *Server, token, chitID string, amount float64, paidOn string, want int) ChitInstallmentDTO {
	t.Helper()
	rr := apiRequest(t, srv, token, http.MethodPost, "/api/chits/"+chitID+"/installments", map[string]any{
		"amount":  amount,
		"paid_on": paidOn,
		"note":    "",
	})
	if rr.Code != want {
		t.Fatalf("add installment status = %d body = %s, want %d", rr.Code, rr.Body.String(), want)
	}
	if want != http.StatusCreated {
		return ChitInstallmentDTO{}
	}
	var out ChitInstallmentDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode installment: %v", err)
	}
	return out
}

func TestChitLifecycleAndProgress(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	body := validChitBody()
	body["total_installments"] = 2
	chit := createChit(t, srv, token, body)
	if chit.Status != "active" || chit.InstallmentCount != 0 || chit.TotalPaid != 0 {
		t.Fatalf("new chit = %+v, want active/0/0", chit)
	}

	addInstallment(t, srv, token, chit.ID, 4800, "2026-07-10", http.StatusCreated)
	detail := getChitDetail(t, srv, token, chit.ID)
	if detail.InstallmentCount != 1 || detail.Status != "active" || detail.TotalPaid != 4800 {
		t.Fatalf("after 1: count=%d status=%s paid=%v", detail.InstallmentCount, detail.Status, detail.TotalPaid)
	}
	if len(detail.Installments) != 1 {
		t.Fatalf("embedded installments = %d, want 1", len(detail.Installments))
	}

	addInstallment(t, srv, token, chit.ID, 5000, "2026-08-10", http.StatusCreated)
	detail = getChitDetail(t, srv, token, chit.ID)
	if detail.Status != "completed" || detail.InstallmentCount != 2 {
		t.Fatalf("after 2: status=%s count=%d, want completed/2", detail.Status, detail.InstallmentCount)
	}

	addInstallment(t, srv, token, chit.ID, 5000, "2026-09-10", http.StatusConflict)

	// Delete one installment → active again.
	instID := detail.Installments[0].ID
	rr := apiRequest(t, srv, token, http.MethodDelete, "/api/chits/"+chit.ID+"/installments/"+instID, nil)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("delete installment status = %d", rr.Code)
	}
	detail = getChitDetail(t, srv, token, chit.ID)
	if detail.Status != "active" || detail.InstallmentCount != 1 {
		t.Fatalf("after delete: status=%s count=%d, want active/1", detail.Status, detail.InstallmentCount)
	}
}

func TestChitDeleteCascadesInstallments(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	chit := createChit(t, srv, token, validChitBody())
	addInstallment(t, srv, token, chit.ID, 5000, "2026-07-10", http.StatusCreated)

	rr := apiRequest(t, srv, token, http.MethodDelete, "/api/chits/"+chit.ID, nil)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d body = %s", rr.Code, rr.Body.String())
	}

	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM chit_installments WHERE chit_id = $1`, chit.ID).Scan(&count); err != nil {
		t.Fatalf("count installments: %v", err)
	}
	if count != 0 {
		t.Fatalf("orphaned installments = %d, want 0", count)
	}
}

func TestChitIsScopedToOwner(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	chit := createChit(t, srv, token, validChitBody())
	inst := addInstallment(t, srv, token, chit.ID, 5000, "2026-07-10", http.StatusCreated)

	otherID := uuid.New()
	if err := srv.provisionUser(context.Background(), auth.Identity{UserID: otherID, Email: "other-chit@example.com"}); err != nil {
		t.Fatalf("provision second user: %v", err)
	}
	otherToken := signedTestToken(t, otherID)

	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"get", http.MethodGet, "/api/chits/" + chit.ID, nil},
		{"update", http.MethodPatch, "/api/chits/" + chit.ID, validChitBody()},
		{"delete", http.MethodDelete, "/api/chits/" + chit.ID, nil},
		{"add installment", http.MethodPost, "/api/chits/" + chit.ID + "/installments", map[string]any{
			"amount": 100, "paid_on": "2026-07-11", "note": "",
		}},
		{"update installment", http.MethodPatch, "/api/chits/" + chit.ID + "/installments/" + inst.ID, map[string]any{
			"amount": 100, "paid_on": "2026-07-11", "note": "",
		}},
		{"delete installment", http.MethodDelete, "/api/chits/" + chit.ID + "/installments/" + inst.ID, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := apiRequest(t, srv, otherToken, tc.method, tc.path, tc.body)
			if rr.Code != http.StatusNotFound {
				t.Fatalf("status = %d body = %s, want 404", rr.Code, rr.Body.String())
			}
		})
	}

	if got := getChitDetail(t, srv, token, chit.ID); got.Name != "Office Chit A" {
		t.Fatalf("owner chit changed: %+v", got)
	}
	rr := apiRequest(t, srv, otherToken, http.MethodGet, "/api/chits", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d", rr.Code)
	}
	var list []ChitSummaryDTO
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list) != 0 {
		t.Fatalf("other user sees %d chits, want 0", len(list))
	}
}

func TestChitInstallmentWrongParent(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	a := createChit(t, srv, token, validChitBody())
	bBody := validChitBody()
	bBody["name"] = "Other scheme"
	b := createChit(t, srv, token, bBody)
	inst := addInstallment(t, srv, token, a.ID, 5000, "2026-07-10", http.StatusCreated)

	rr := apiRequest(t, srv, token, http.MethodPatch, "/api/chits/"+b.ID+"/installments/"+inst.ID, map[string]any{
		"amount": 100, "paid_on": "2026-07-11", "note": "x",
	})
	if rr.Code != http.StatusNotFound {
		t.Fatalf("wrong-parent update status = %d, want 404", rr.Code)
	}
	rr = apiRequest(t, srv, token, http.MethodDelete, "/api/chits/"+b.ID+"/installments/"+inst.ID, nil)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("wrong-parent delete status = %d, want 404", rr.Code)
	}
}

func TestChitValidation(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	cases := []struct {
		name string
		body map[string]any
	}{
		{"empty name", map[string]any{
			"name": "  ", "organizer": "Ramesh", "chit_value": 100000, "expected_monthly": 5000,
			"total_installments": 20, "start_month": "2026-07-01",
		}},
		{"bad start day", map[string]any{
			"name": "A", "organizer": "Ramesh", "chit_value": 100000, "expected_monthly": 5000,
			"total_installments": 20, "start_month": "2026-07-15",
		}},
		{"zero value", map[string]any{
			"name": "A", "organizer": "Ramesh", "chit_value": 0, "expected_monthly": 5000,
			"total_installments": 20, "start_month": "2026-07-01",
		}},
		{"too many installments", map[string]any{
			"name": "A", "organizer": "Ramesh", "chit_value": 100000, "expected_monthly": 5000,
			"total_installments": 361, "start_month": "2026-07-01",
		}},
		{"three decimals", map[string]any{
			"name": "A", "organizer": "Ramesh", "chit_value": 100.501, "expected_monthly": 5000,
			"total_installments": 20, "start_month": "2026-07-01",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := apiRequest(t, srv, token, http.MethodPost, "/api/chits", tc.body)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body = %s, want 400", rr.Code, rr.Body.String())
			}
		})
	}

	rr := apiRequest(t, srv, token, http.MethodGet, "/api/chits/not-a-uuid", nil)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid uuid status = %d, want 400", rr.Code)
	}
}

func TestChitLockedFieldsAfterInstallment(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	chit := createChit(t, srv, token, validChitBody())
	addInstallment(t, srv, token, chit.ID, 5000, "2026-07-10", http.StatusCreated)

	body := validChitBody()
	body["name"] = "Renamed"
	body["organizer"] = "New Org"
	body["chit_value"] = 200000
	// Locked field change
	body["expected_monthly"] = 6000
	rr := apiRequest(t, srv, token, http.MethodPatch, "/api/chits/"+chit.ID, body)
	if rr.Code != http.StatusConflict {
		t.Fatalf("locked field change status = %d, want 409", rr.Code)
	}

	// Unlocked fields only — keep locked values identical
	body = validChitBody()
	body["name"] = "Renamed"
	body["organizer"] = "New Org"
	body["chit_value"] = 200000
	rr = apiRequest(t, srv, token, http.MethodPatch, "/api/chits/"+chit.ID, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("unlocked update status = %d body = %s", rr.Code, rr.Body.String())
	}
	var got ChitSummaryDTO
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got.Name != "Renamed" || got.ChitValue != 200000 || got.ExpectedMonthly != 5000 {
		t.Fatalf("unexpected update result: %+v", got)
	}
}

func TestChitTotalBelowRecordedCount(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	body := validChitBody()
	body["total_installments"] = 5
	chit := createChit(t, srv, token, body)
	addInstallment(t, srv, token, chit.ID, 5000, "2026-07-10", http.StatusCreated)
	addInstallment(t, srv, token, chit.ID, 5000, "2026-08-10", http.StatusCreated)

	// total_installments < installment_count is checked before the lock rule → 400.
	patch := validChitBody()
	patch["total_installments"] = 1
	rr := apiRequest(t, srv, token, http.MethodPatch, "/api/chits/"+chit.ID, patch)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s, want 400", rr.Code, rr.Body.String())
	}
}

func TestChitListIncludesAggregates(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	chit := createChit(t, srv, token, validChitBody())
	addInstallment(t, srv, token, chit.ID, 4800, "2026-07-10", http.StatusCreated)

	rr := apiRequest(t, srv, token, http.MethodGet, "/api/chits", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d", rr.Code)
	}
	var list []ChitSummaryDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("list len = %d, want 1", len(list))
	}
	if list[0].InstallmentCount != 1 || list[0].TotalPaid != 4800 || list[0].Status != "active" {
		t.Fatalf("aggregates = %+v", list[0])
	}
}

func TestChitConcurrentInstallmentCap(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()

	body := validChitBody()
	body["total_installments"] = 1
	chit := createChit(t, srv, token, body)

	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(day int) {
			defer wg.Done()
			rr := apiRequest(t, srv, token, http.MethodPost, "/api/chits/"+chit.ID+"/installments", map[string]any{
				"amount": 5000, "paid_on": fmt.Sprintf("2026-07-%02d", 10+day), "note": "",
			})
			codes <- rr.Code
		}(i)
	}
	wg.Wait()
	close(codes)

	var created, conflict int
	for c := range codes {
		switch c {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflict++
		default:
			t.Fatalf("unexpected status %d", c)
		}
	}
	if created != 1 || conflict != 1 {
		t.Fatalf("created=%d conflict=%d, want 1/1", created, conflict)
	}
	detail := getChitDetail(t, srv, token, chit.ID)
	if detail.InstallmentCount != 1 {
		t.Fatalf("count = %d, want 1", detail.InstallmentCount)
	}
}
