package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func eventRequest(t *testing.T, s *Server, token, method, path string, body any, version int64) *httptest.ResponseRecorder {
	t.Helper()
	var b bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&b).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, path, &b)
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("Content-Type", "application/json")
	if version > 0 {
		r.Header.Set("If-Match", fmt.Sprintf("\"%d\"", version))
	}
	w := httptest.NewRecorder()
	s.Router().ServeHTTP(w, r)
	return w
}
func decodeEvent(t *testing.T, w *httptest.ResponseRecorder, code int) eventDTO {
	t.Helper()
	if w.Code != code {
		t.Fatalf("status %d want %d: %s", w.Code, code, w.Body.String())
	}
	var d eventDTO
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	return d
}
func eventPut(d eventDTO) map[string]any {
	items := []map[string]any{}
	if d.Items != nil {
		for _, i := range *d.Items {
			items = append(items, map[string]any{"id": i.ID, "name": i.Name, "expected_cost": i.ExpectedCost, "actual_cost": i.ActualCost})
		}
	}
	return map[string]any{"name": d.Name, "note": d.Note, "target_date": d.TargetDate, "status": d.Status, "suggestions_enabled": d.SuggestionsEnabled, "version": d.Version, "items": items}
}
func TestEventsCRUDLifecycleDuplicationAndDeletion(t *testing.T) {
	s, pool, token, uid := setupCategoryAPITest(t)
	defer pool.Close()
	ctx := context.Background()
	before := apiRequest(t, s, token, "GET", "/api/dashboard/monthly?month=2026-06", nil).Body.String()
	body := map[string]any{"name": "Service", "target_date": "2026-06-15", "items": []map[string]any{{"name": "Labour", "expected_cost": 3000}, {"name": "Parts", "expected_cost": 5000}}}
	d := decodeEvent(t, eventRequest(t, s, token, "POST", "/api/events", body, 0), 201)
	path := "/api/events/" + d.ID.String()
	if d.Version != 1 || d.Status != "planned" || !d.SuggestionsEnabled || d.Summary.ExpectedTotal != "8000.00" || !d.Summary.BudgetComplete || d.Summary.CanComplete {
		t.Fatal(d)
	}
	get := decodeEvent(t, eventRequest(t, s, token, "GET", path, nil, 0), 200)
	if len(*get.Items) != 2 {
		t.Fatal(get)
	}
	invalid := eventPut(d)
	invalid["status"] = "completed"
	if w := eventRequest(t, s, token, "PUT", path, invalid, 0); w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	update := eventPut(d)
	items := update["items"].([]map[string]any)
	items[0]["actual_cost"] = 3500
	items[1]["actual_cost"] = 0
	update["items"] = []map[string]any{items[1], items[0]}
	update["status"] = "completed"
	d = decodeEvent(t, eventRequest(t, s, token, "PUT", path, update, 0), 200)
	if d.Version != 2 || !d.Summary.CanComplete || (*d.Items)[0].ID != (*get.Items)[1].ID {
		t.Fatal(d)
	}
	if w := eventRequest(t, s, token, "PUT", path, update, 0); w.Code != 409 {
		t.Fatal("stale", w.Code)
	}
	invalid = eventPut(d)
	invalid["items"] = []any{}
	if w := eventRequest(t, s, token, "PUT", path, invalid, 0); w.Code != 400 {
		t.Fatal("empty completion", w.Code)
	}
	// All explicit statuses remain reversible; completed edits retain actuals.
	for _, status := range []string{"cancelled", "planned", "in_progress", "completed"} {
		update = eventPut(d)
		update["status"] = status
		d = decodeEvent(t, eventRequest(t, s, token, "PUT", path, update, 0), 200)
		if d.Status != status {
			t.Fatal(d.Status)
		}
	}
	copy := decodeEvent(t, eventRequest(t, s, token, "POST", path+"/duplicate", map[string]any{}, 0), 201)
	if copy.ID == d.ID || copy.Name != "Service (copy)" || copy.TargetDate != nil || copy.Status != "planned" || copy.Version != 1 || copy.Summary.MissingActualCount != 2 || (*copy.Items)[0].ID == (*d.Items)[0].ID {
		t.Fatal(copy)
	}
	// Unknown child IDs are rejected without changing the aggregate/version.
	update = eventPut(d)
	update["items"].([]map[string]any)[0]["id"] = (*copy.Items)[0].ID
	if w := eventRequest(t, s, token, "PUT", path, update, 0); w.Code != 400 {
		t.Fatal(w.Code)
	}
	unchanged := decodeEvent(t, eventRequest(t, s, token, "GET", path, nil, 0), 200)
	if unchanged.Version != d.Version {
		t.Fatal("failed mutation changed version")
	}
	// Reopen and clear items atomically.
	update = eventPut(d)
	update["status"] = "planned"
	update["items"] = []any{}
	d = decodeEvent(t, eventRequest(t, s, token, "PUT", path, update, 0), 200)
	if d.Summary.ItemCount != 0 {
		t.Fatal(d)
	}
	if w := eventRequest(t, s, token, "DELETE", path, nil, d.Version-1); w.Code != 409 {
		t.Fatal(w.Code)
	}
	if w := eventRequest(t, s, token, "DELETE", path, nil, d.Version); w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		w := eventRequest(t, s, token, method, path, eventPut(d), d.Version)
		if w.Code != 404 {
			t.Fatal(method, w.Code, w.Body.String())
		}
	}
	if w := eventRequest(t, s, token, "POST", path+"/duplicate", map[string]any{}, 0); w.Code != 404 {
		t.Fatal(w.Code)
	}
	var deleted bool
	if err := pool.QueryRow(ctx, "SELECT deleted_at IS NOT NULL FROM events WHERE id=$1 AND user_id=$2", d.ID, uid).Scan(&deleted); err != nil || !deleted {
		t.Fatal(deleted, err)
	}
	// Delete the copy with its items still present: soft-delete must retain children.
	copyPath := "/api/events/" + copy.ID.String()
	if w := eventRequest(t, s, token, "DELETE", copyPath, nil, copy.Version); w.Code != 204 {
		t.Fatal(w.Code)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM event_items WHERE event_id=$1", copy.ID).Scan(&count); err != nil || count != 2 {
		t.Fatal(count, err)
	}
	after := apiRequest(t, s, token, "GET", "/api/dashboard/monthly?month=2026-06", nil).Body.String()
	if before != after {
		t.Fatal("events changed financial dashboard")
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM transactions WHERE user_id=$1", uid).Scan(&count); err != nil || count != 0 {
		t.Fatal("event wrote transactions", count, err)
	}
}
func TestEventSuggestions(t *testing.T) {
	s, pool, token, uid := setupCategoryAPITest(t)
	defer pool.Close()
	s.now = func() time.Time { return time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC) }
	insertTxn(t, pool, uid, "income", "Salary", 10000, "2026-06-01", "cash")
	var deleted eventDTO
	tests := []struct {
		name, status    string
		date            any
		enabled         bool
		expected        any
		empty, eligible bool
	}{
		{"dated", "planned", "2026-06-30", true, 8000, false, true},
		{"old", "planned", "2026-05-01", true, 6000, false, true},
		{"undated", "planned", nil, true, 10000, false, true},
		{"free", "planned", nil, true, 0, false, true},
		{"too much", "planned", nil, true, 10000.01, false, false},
		{"future", "planned", "2026-07-01", true, 1, false, false},
		{"disabled", "planned", nil, false, 1, false, false},
		{"in progress", "in_progress", nil, true, 1, false, false},
		{"completed", "completed", nil, true, 1, false, false},
		{"cancelled", "cancelled", nil, true, 1, false, false},
		{"incomplete", "planned", nil, true, nil, false, false},
		{"empty", "planned", nil, true, nil, true, false},
		{"deleted", "planned", nil, true, 1, false, false},
	}
	want := map[string]bool{}
	for _, tc := range tests {
		items := []map[string]any{}
		if !tc.empty {
			items = append(items, map[string]any{"name": "Item", "expected_cost": tc.expected, "actual_cost": 500})
		}
		d := decodeEvent(t, eventRequest(t, s, token, "POST", "/api/events", map[string]any{"name": tc.name, "status": tc.status, "target_date": tc.date, "suggestions_enabled": tc.enabled, "items": items}, 0), 201)
		if tc.name == "deleted" {
			deleted = d
		}
		if tc.eligible {
			want[tc.name] = true
		}
	}
	if w := eventRequest(t, s, token, "DELETE", "/api/events/"+deleted.ID.String(), nil, deleted.Version); w.Code != 204 {
		t.Fatal(w.Code)
	}
	path := "/api/events/suggestions?month=2026-06&timezone=UTC"
	check := func(path string) eventSuggestionsResponse {
		t.Helper()
		w := eventRequest(t, s, token, "GET", path, nil, 0)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var out eventSuggestionsResponse
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	out := check(path)
	if out.FreeMoney == nil || *out.FreeMoney != 10000 || len(out.Events) != len(want) {
		t.Fatalf("%+v", out)
	}
	for _, e := range out.Events {
		if !want[e.Name] {
			t.Fatal("unexpected", e.Name)
		}
	}
	if out.Events[0].Name != "old" || out.Events[1].Name != "dated" {
		t.Fatal("ordering", out.Events)
	}
	page := check(path + "&limit=1&offset=1")
	if len(page.Events) != 1 || page.Events[0].Name != "dated" || !page.HasMore {
		t.Fatal(page)
	}
	for _, month := range []string{"2026-05", "2026-07"} {
		o := check("/api/events/suggestions?month=" + month)
		if len(o.Events) != 0 || o.FreeMoney != nil {
			t.Fatal(o)
		}
	}
	// Zero / negative free money suppress every candidate, including free events.
	for _, budget := range []int{10000, 12000} {
		_, err := pool.Exec(context.Background(), `INSERT INTO monthly_budgets(user_id,month,budget_essential,budget_flexible,budget_daily) VALUES($1,'2026-06-01',$2,0,0) ON CONFLICT(user_id,month) DO UPDATE SET budget_essential=$2`, uid, budget)
		if err != nil {
			t.Fatal(err)
		}
		if o := check(path); len(o.Events) != 0 {
			t.Fatal(o)
		}
	}
}
func TestEventIsolationAndConcurrentWrites(t *testing.T) {
	s, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	d := decodeEvent(t, eventRequest(t, s, token, "POST", "/api/events", map[string]any{"name": "Private"}, 0), 201)
	path := "/api/events/" + d.ID.String()
	other := signedTestToken(t, uuid.New())
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		w := eventRequest(t, s, other, method, path, eventPut(d), 1)
		if w.Code != 404 {
			t.Fatal(method, w.Code, w.Body.String())
		}
	}
	if w := eventRequest(t, s, other, "POST", path+"/duplicate", map[string]any{}, 0); w.Code != 404 {
		t.Fatal(w.Code)
	}
	for _, path := range []string{"/api/events", "/api/events/suggestions?month=" + s.now().UTC().Format("2006-01")} {
		w := eventRequest(t, s, other, "GET", path, nil, 0)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"events":[]`) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	payload := eventPut(d)
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	router := s.Router()
	codes := make(chan int, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			r := httptest.NewRequest("PUT", path, bytes.NewReader(data))
			r.Header.Set("Authorization", "Bearer "+token)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			codes <- w.Code
		}()
	}
	close(start)
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for c := range codes {
		counts[c]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatal(counts)
	}
}
