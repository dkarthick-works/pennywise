package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestGroupSpendHistory(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	insertTxn(t, pool, userID, "daily", "Swiggy", 100, "2026-06-10", "cash")
	insertTxn(t, pool, userID, "daily", "Swiggy", 100, "2026-08-01", "cash")
	insertTxn(t, pool, userID, "flexible", "  SWIGGY  ", 300, "2026-08-02", "credit")
	insertTxn(t, pool, userID, "daily", "Zomato", 200, "2026-08-03", "cash")
	insertTxn(t, pool, userID, "income", "Swiggy", 50, "2026-08-04", "cash")
	insertTxn(t, pool, userID, "essential", "Swiggy", 25, "2026-08-05", "settlement")

	food := createGroup(t, srv, token, "Online Food")
	mapCategory(t, srv, token, "Swiggy", food.ID, http.StatusCreated, "")
	mapCategory(t, srv, token, "Zomato", food.ID, http.StatusCreated, "")
	unused := createGroup(t, srv, token, "Unused")

	rr := apiRequest(t, srv, token, http.MethodGet,
		"/api/dashboard/group-spend/history?to=2026-08&months=3", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rr.Code, rr.Body.String())
	}
	var got GroupSpendHistoryDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode history: %v", err)
	}
	if got.From != "2026-06" || got.To != "2026-08" || got.Months != 3 {
		t.Fatalf("range = %s..%s (%d), want 2026-06..2026-08 (3)", got.From, got.To, got.Months)
	}
	if len(got.Groups) != 2 || got.Groups[0].GroupID != food.ID || got.Groups[1].GroupID != unused.ID {
		t.Fatalf("groups = %#v, want Online Food then Unused", got.Groups)
	}
	if len(got.MonthlyCosts) != 3 {
		t.Fatalf("monthly costs length = %d, want 3", len(got.MonthlyCosts))
	}
	assertFloat(t, "june monthly cost", got.MonthlyCosts[0].Total, 100)
	assertFloat(t, "july monthly cost", got.MonthlyCosts[1].Total, 0)
	assertFloat(t, "august monthly cost", got.MonthlyCosts[2].Total, 600)

	foodHistory := got.Groups[0]
	if len(foodHistory.Mappings) != 2 || len(foodHistory.Buckets) != 3 {
		t.Fatalf("food history shape = %#v", foodHistory)
	}
	july := foodHistory.Buckets[1]
	if july.Total != 0 || july.TransactionCount != 0 || july.AverageTransaction != nil || july.MedianTransaction != nil || july.LargestTransaction != nil || len(july.Categories) != 0 {
		t.Fatalf("july bucket = %#v, want explicit empty bucket", july)
	}
	august := foodHistory.Buckets[2]
	assertFloat(t, "august group total", august.Total, 675)
	if august.TransactionCount != 5 {
		t.Fatalf("august count = %d, want 5", august.TransactionCount)
	}
	assertFloatPtr(t, "august average", august.AverageTransaction, 135)
	assertFloatPtr(t, "august median", august.MedianTransaction, 100)
	assertFloatPtr(t, "august largest", august.LargestTransaction, 300)
	if len(august.Categories) != 2 {
		t.Fatalf("august categories = %#v", august.Categories)
	}
	if august.Categories[0].Category != "Swiggy" || august.Categories[0].TransactionCount != 4 {
		t.Fatalf("first contribution = %#v", august.Categories[0])
	}
	assertFloat(t, "swiggy contribution", august.Categories[0].Total, 475)
}

func TestGroupSpendHistoryFilteringAndValidation(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	insertTxn(t, pool, userID, "daily", "Food", 10, "2026-08-01", "cash")
	createGroup(t, srv, token, "First")
	second := createGroup(t, srv, token, "Second")

	path := "/api/dashboard/group-spend/history?to=2026-08&months=3&group_ids=" + second.ID + "," + second.ID
	rr := apiRequest(t, srv, token, http.MethodGet, path, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("filtered status = %d body = %s", rr.Code, rr.Body.String())
	}
	var got GroupSpendHistoryDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode filtered history: %v", err)
	}
	if len(got.Groups) != 1 || got.Groups[0].GroupID != second.ID {
		t.Fatalf("filtered groups = %#v", got.Groups)
	}

	for _, badPath := range []string{
		"/api/dashboard/group-spend/history?to=bad&months=3",
		"/api/dashboard/group-spend/history?to=2026-13&months=3",
		"/api/dashboard/group-spend/history?to=2026-08&months=4",
		"/api/dashboard/group-spend/history?to=2026-08&months=3&group_ids=bad",
	} {
		rr = apiRequest(t, srv, token, http.MethodGet, badPath, nil)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d body = %s, want 400", badPath, rr.Code, rr.Body.String())
		}
	}

	rr = apiRequest(t, srv, token, http.MethodGet,
		"/api/dashboard/group-spend/history?to=2026-08&months=3&group_ids="+uuid.NewString(), nil)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("missing group status = %d body = %s, want 404", rr.Code, rr.Body.String())
	}

	// A valid group owned by another user is indistinguishable from a missing ID.
	otherID := uuid.New()
	if _, err := pool.Exec(context.Background(), `INSERT INTO users (id, email) VALUES ($1, $2)`, otherID, "other-history@example.com"); err != nil {
		t.Fatalf("insert other user: %v", err)
	}
	var otherGroupID uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO category_groups (user_id, name, normalized_name)
		VALUES ($1, 'Other', 'other') RETURNING id
	`, otherID).Scan(&otherGroupID); err != nil {
		t.Fatalf("insert other group: %v", err)
	}
	rr = apiRequest(t, srv, token, http.MethodGet,
		"/api/dashboard/group-spend/history?to=2026-08&months=3&group_ids="+otherGroupID.String(), nil)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("other-user group status = %d body = %s, want 404", rr.Code, rr.Body.String())
	}

}

func assertFloatPtr(t *testing.T, field string, got *float64, want float64) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want %v", field, want)
	}
	assertFloat(t, field, *got, want)
}
