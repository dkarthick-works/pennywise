package api

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/ledger/backend/internal/db"
)

func TestEventMoney(t *testing.T) {
	for _, s := range []string{"null", "0", "0.01", "8000", "999999999999.99", "1e2"} {
		n, err := eventMoney(json.RawMessage(s))
		if err != nil {
			t.Fatalf("%s: %v", s, err)
		}
		if s == "null" {
			if n.Valid {
				t.Fatal("null became zero")
			}
			continue
		}
		if !n.Valid {
			t.Fatalf("%s invalid", s)
		}
	}
	for _, s := range []string{"-1", "0.001", "999999999999.999", "1000000000000", "\"12\"", "true", "{}", "NaN", "1e999999", "1e-999999"} {
		if _, err := eventMoney(json.RawMessage(s)); err == nil {
			t.Errorf("accepted %s", s)
		}
	}
	n, _ := eventMoney(json.RawMessage("123456789012.34"))
	if got := string(*eventNumber(n)); got != "123456789012.34" {
		t.Fatal(got)
	}
}
func TestEventValidationAndCompletion(t *testing.T) {
	tests := []struct {
		body          string
		update, valid bool
	}{
		{`{"name":" Service "}`, false, true},
		{`{"name":"Service","status":"completed"}`, false, false},
		{`{"name":"Service","status":"completed","items":[{"name":"Bill","actual_cost":0}]}`, false, true},
		{`{"name":"Service","status":"completed","items":[{"name":"Bill","expected_cost":100}]}`, false, false},
		{`{"name":"Service","status":"in_progress","items":[{"name":"Bill","expected_cost":1,"actual_cost":100}]}`, false, true},
		{`{"name":"Service","status":"cancelled"}`, false, true},
		{`{"name":"  "}`, false, false},
		{`{"name":"Service","status":"unknown"}`, false, false},
		{`{"name":"Service","target_date":"2026-02-30"}`, false, false},
		{`{"name":"Service","target_date":""}`, false, false},
		{`{"name":"Service","target_date":null}`, false, true},
		{`{"name":"Service","target_date":12}`, false, false},
		{`{"name":"Service","items":[{"name":""}]}`, false, false},
		{`{"name":"Service","note":"","target_date":null,"status":"planned","suggestions_enabled":false,"version":1,"items":[]}`, true, true},
		{`{"name":"Service","note":"","target_date":null,"status":"planned","suggestions_enabled":false,"version":0,"items":[]}`, true, false},
		{`{"name":"Service"}`, true, false},
		{`{"name":"Service","note":"","target_date":null,"status":"planned","suggestions_enabled":false,"version":1,"items":[{"name":"Bill"}]}`, true, false},
	}
	for _, tc := range tests {
		t.Run(tc.body, func(t *testing.T) {
			var in eventInput
			if err := json.Unmarshal([]byte(tc.body), &in); err != nil {
				t.Fatal(err)
			}
			_, _, err := in.parse(tc.update)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v err=%v", tc.valid, err)
			}
		})
	}
	var in eventInput
	_ = json.Unmarshal([]byte(`{"name":" Service "}`), &in)
	p, _, _ := in.parse(false)
	if p.Name != "Service" || !p.SuggestionsEnabled || p.Status != "planned" {
		t.Fatalf("defaults %+v", p)
	}
	name := strings.Repeat("x", 201)
	in.Name = &name
	if _, _, err := in.parse(false); err == nil {
		t.Fatal("long name accepted")
	}
}
func TestEventSummaryExactAndIncomplete(t *testing.T) {
	e := db.Event{}
	empty := eventDetail(e, nil)
	if empty.Summary.BudgetComplete || empty.Summary.CanComplete || empty.Items == nil || len(*empty.Items) != 0 {
		t.Fatal(empty)
	}
	a, _ := eventMoney(json.RawMessage("0.10"))
	b, _ := eventMoney(json.RawMessage("0.20"))
	zero, _ := eventMoney(json.RawMessage("0"))
	d := eventDetail(e, []db.EventItem{{ExpectedCost: a, ActualCost: zero}, {ExpectedCost: b}})
	if d.Summary.ExpectedTotal != "0.30" || d.Summary.ActualTotal != "0.00" || !d.Summary.BudgetComplete || d.Summary.ActualsComplete || d.Summary.MissingActualCount != 1 {
		t.Fatalf("%+v", d.Summary)
	}
	if (*d.Items)[0].ActualCost == nil || (*d.Items)[1].ActualCost != nil {
		t.Fatal("null/zero lost")
	}
	d = eventDetail(e, []db.EventItem{{ActualCost: zero}})
	if d.Summary.BudgetComplete || !d.Summary.CanComplete {
		t.Fatal(d.Summary)
	}
	max, _ := eventMoney(json.RawMessage("999999999999.99"))
	d = eventDetail(e, []db.EventItem{{ExpectedCost: max}, {ExpectedCost: max}})
	if d.Summary.ExpectedTotal != "1999999999999.98" {
		t.Fatal(d.Summary.ExpectedTotal)
	}
	if paiseJSON(big.NewInt(1)) != "0.01" {
		t.Fatal("paise")
	}
}
func TestEventCalendar(t *testing.T) {
	now := time.Date(2026, 12, 31, 20, 0, 0, 0, time.UTC)
	for _, tc := range []struct{ zone, want string }{{"", "2026-12"}, {"UTC", "2026-12"}, {"Asia/Kolkata", "2027-01"}, {"America/New_York", "2026-12"}} {
		got, _, err := eventCalendar("2026-12", tc.zone, now)
		if err != nil || got != tc.want {
			t.Fatalf("%+v %s %v", tc, got, err)
		}
	}
	for _, tc := range [][2]string{{"bad", "UTC"}, {"2026-13", "UTC"}, {"2026-01", "bad-zone"}, {"2026-01", "Local"}} {
		if _, _, err := eventCalendar(tc[0], tc[1], now); err == nil {
			t.Fatal(tc)
		}
	}
	leap := time.Date(2024, 2, 29, 23, 59, 0, 0, time.UTC)
	if got, _, _ := eventCalendar("2024-02", "UTC", leap); got != "2024-02" {
		t.Fatal(got)
	}
}
func TestEventBodyAndPagination(t *testing.T) {
	for _, tc := range []struct {
		body string
		code int
	}{{`{"name":"ok","unknown":1}`, 400}, {`{"name":"ok"} {}`, 400}, {`{"name":"` + strings.Repeat("x", 1<<20) + `"}`, 413}} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/", strings.NewReader(tc.body))
		var in eventInput
		if readEventJSON(w, r, &in) || w.Code != tc.code {
			t.Fatalf("code %d want %d", w.Code, tc.code)
		}
	}
	for _, query := range []string{"limit=0", "limit=101", "offset=-1", "offset=2147483648", "limit=x"} {
		if _, _, err := eventPagination(httptest.NewRequest("GET", "/?"+query, nil)); err == nil {
			t.Fatal(query)
		}
	}
	limit, offset, err := eventPagination(httptest.NewRequest("GET", "/", nil))
	if err != nil || limit != 50 || offset != 0 {
		t.Fatal(limit, offset, err)
	}
}
func TestEventItemIDs(t *testing.T) {
	id := uuid.New()
	body := fmt.Sprintf(`{"name":"X","note":"","target_date":null,"status":"planned","suggestions_enabled":true,"version":1,"items":[{"id":%q,"name":"a","expected_cost":null,"actual_cost":null},{"id":%q,"name":"b","expected_cost":null,"actual_cost":null}]}`, id, id)
	var in eventInput
	_ = json.Unmarshal([]byte(body), &in)
	if _, _, err := in.parse(true); err == nil {
		t.Fatal("duplicate IDs accepted")
	}
	items := make([]eventItemInput, 501)
	in.Items = &items
	if _, _, err := in.parse(true); err == nil {
		t.Fatal("too many items accepted")
	}
}
