package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/google/uuid"
)

func TestTransactionSearchValidation(t *testing.T) {
	for _, query := range []string{
		"", "q=+", "q=" + strings.Repeat("x", 101), "q=test&limit=0", "q=test&limit=101", "q=test&limit=x",
		"q=test&section=misc", "q=test&kind=other", "q=test&from=2026-02-30", "q=test&to=0000-01-01",
		"q=test&from=2026-02-01&to=2026-01-01", "q=test&min_amount=NaN", "q=test&min_amount=1.001",
		"q=test&min_amount=1000000000000", "q=test&max_amount=Infinity", "q=test&min_amount=2&max_amount=1",
		"q=test%00", "q=%FF", "q=test&sort=unknown",
	} {
		t.Run(query, func(t *testing.T) {
			values, _ := url.ParseQuery(query)
			if _, _, err := parseTransactionSearchParams(values); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
	p, limit, err := parseTransactionSearchParams(url.Values{"q": {"Coffee"}, "min_amount": {"0.10"}, "max_amount": {"0.20"}})
	if err != nil || limit != 20 || p.ResultLimit != 21 {
		t.Fatalf("defaults: %#v %d %v", p, limit, err)
	}
}

func TestTransactionSearchCursorIntegrity(t *testing.T) {
	uid := uuid.New()
	values := url.Values{"q": {"coffee"}}
	binding := transactionSearchBinding(uid, values)
	original := transactionSearchCursor{Version: 1, Binding: binding, Tier: 3, Score: 300000, Date: "2026-01-01", ID: uuid.New()}
	raw := encodeTransactionSearchCursor(original, "secret")
	got, err := decodeTransactionSearchCursor(raw, binding, "secret")
	if err != nil || got != original {
		t.Fatalf("roundtrip: %#v %v", got, err)
	}
	for _, check := range []struct{ raw, binding, secret string }{
		{raw + "x", binding, "secret"}, {raw, binding, "wrong"}, {"garbage", binding, "secret"},
		{raw, transactionSearchBinding(uuid.New(), values), "secret"},
		{raw, transactionSearchBinding(uid, url.Values{"q": {"coffee"}, "kind": {"cash"}}), "secret"},
	} {
		if _, err := decodeTransactionSearchCursor(check.raw, check.binding, check.secret); err == nil {
			t.Fatal("accepted invalid cursor")
		}
	}
}

func TestTransactionSearchAPI(t *testing.T) {
	srv, pool, token, uid := setupCategoryAPITest(t)
	defer pool.Close()
	ctx := context.Background()
	ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	add := func(id, name, date, section, kind string, amount float64) string {
		parsed := uuid.MustParse(id)
		insertTxnWithID(t, pool, parsed, uid, section, name, amount, date, kind, ts, ts)
		return parsed.String()
	}
	exactLow := add("00000000-0000-0000-0000-000000000001", "  COFFEE  ", "2026-01-01", "daily", "cash", 10)
	exactHigh := add("00000000-0000-0000-0000-000000000002", "Coffee", "2026-01-01", "daily", "cash", 20)
	exactNew := add("00000000-0000-0000-0000-000000000003", "Coffee", "2026-02-01", "daily", "credit", 30)
	prefix := add("00000000-0000-0000-0000-000000000004", "Coffee Shop", "2026-03-01", "flexible", "cash", 40)
	contains := add("00000000-0000-0000-0000-000000000005", "Iced Coffee", "2026-04-01", "income", "cash", 50)
	fuzzy := add("00000000-0000-0000-0000-000000000006", "Coffe", "2026-05-01", "essential", "cash", 60)
	settlement := add("00000000-0000-0000-0000-000000000007", "Coffee settlement", "2026-06-01", "daily", "settlement", 30)
	if _, err := pool.Exec(ctx, `INSERT INTO settlement_links (settlement_id,credit_id) VALUES ($1,$2)`, settlement, exactNew); err != nil {
		t.Fatal(err)
	}
	other := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id,email) VALUES ($1,'search-private@example.com')`, other); err != nil {
		t.Fatal(err)
	}
	insertTransactionForSuggestionTest(t, pool, other, "daily", "Coffee", "cash")
	insertTransactionForSuggestionTest(t, pool, uid, "daily", "Unrelated", "cash")
	request := func(path string) transactionSearchResponse {
		t.Helper()
		rr := apiRequest(t, srv, token, http.MethodGet, path, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if rr.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("missing private cache header")
		}
		var result transactionSearchResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	all := request("/api/transactions/search?q=coffee")
	if len(all.Items) != 7 {
		t.Fatalf("all=%#v", all.Items)
	}
	want := []string{exactNew, exactHigh, exactLow}
	for i, id := range want {
		if all.Items[i].ID != id {
			t.Fatalf("exact order=%#v", all.Items)
		}
	}
	if !all.Items[0].Settled {
		t.Fatal("credit should be settled across months")
	}
	if all.Items[len(all.Items)-1].ID != fuzzy {
		t.Fatalf("fuzzy missing from first page: %#v", all.Items)
	}
	seenSettlement := false
	for _, item := range all.Items {
		if item.ID == settlement {
			seenSettlement = true
			if len(item.Settles) != 1 || item.Settles[0] != exactNew {
				t.Fatal("missing settlement links")
			}
		}
	}
	if !seenSettlement {
		t.Fatal("settlement absent")
	}
	// Traverse all tiers and ties with a small page; compare to the unpaged order.
	path := "/api/transactions/search?q=coffee&limit=2"
	var ids []string
	for pages := 0; pages < 10; pages++ {
		page := request(path)
		for _, item := range page.Items {
			ids = append(ids, item.ID)
		}
		if !page.HasMore {
			if page.NextCursor != nil {
				t.Fatal("terminal cursor should be null")
			}
			break
		}
		if page.NextCursor == nil {
			t.Fatal("missing next cursor")
		}
		path = "/api/transactions/search?q=coffee&limit=2&cursor=" + url.QueryEscape(*page.NextCursor)
	}
	if len(ids) != len(all.Items) {
		t.Fatalf("paged ids=%v", ids)
	}
	for i, id := range ids {
		if id != all.Items[i].ID {
			t.Fatalf("pagination order=%v", ids)
		}
	}

	for _, test := range []struct {
		sort string
		want []string
	}{
		{"date_asc", []string{exactLow, exactHigh, exactNew, prefix, contains, fuzzy, settlement}},
		{"date_desc", []string{settlement, fuzzy, contains, prefix, exactNew, exactHigh, exactLow}},
	} {
		t.Run(test.sort, func(t *testing.T) {
			base := "/api/transactions/search?q=coffee&sort=" + test.sort
			// Compare both a full page and traversal across equal-date ties.
			full := request(base)
			if len(full.Items) != len(test.want) {
				t.Fatalf("full page count=%d", len(full.Items))
			}
			for i, id := range test.want {
				if full.Items[i].ID != id {
					t.Fatalf("full page order=%#v", full.Items)
				}
			}
			var got []string
			path := base + "&limit=1"
			for pages := 0; pages < 10; pages++ {
				page := request(path)
				for _, item := range page.Items {
					got = append(got, item.ID)
				}
				if !page.HasMore {
					if page.NextCursor != nil {
						t.Fatal("terminal page has cursor")
					}
					break
				}
				if page.NextCursor == nil {
					t.Fatal("missing cursor")
				}
				path = base + "&limit=1&cursor=" + url.QueryEscape(*page.NextCursor)
			}
			if len(got) != len(test.want) {
				t.Fatalf("paged count=%d", len(got))
			}
			for i, id := range test.want {
				if got[i] != id {
					t.Fatalf("paged order=%v", got)
				}
			}
			first := request(base + "&limit=1")
			switched := apiRequest(t, srv, token, http.MethodGet, "/api/transactions/search?q=coffee&sort=relevance&cursor="+url.QueryEscape(*first.NextCursor), nil)
			if switched.Code != http.StatusBadRequest {
				t.Fatalf("changed-sort status=%d", switched.Code)
			}
		})
	}
	explicitDefault := request("/api/transactions/search?q=coffee&sort=relevance")
	for i, item := range explicitDefault.Items {
		if item.ID != all.Items[i].ID {
			t.Fatal("explicit relevance changed default order")
		}
	}
	invalidSort := apiRequest(t, srv, token, http.MethodGet, "/api/transactions/search?q=coffee&sort=unknown", nil)
	if invalidSort.Code != http.StatusBadRequest {
		t.Fatalf("invalid-sort status=%d", invalidSort.Code)
	}
	first := request("/api/transactions/search?q=coffee&limit=1")
	bad := apiRequest(t, srv, token, http.MethodGet, "/api/transactions/search?q=coffe&cursor="+url.QueryEscape(*first.NextCursor), nil)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("mismatched cursor status=%d", bad.Code)
	}
	bad = apiRequest(t, srv, signedTestToken(t, other), http.MethodGet, "/api/transactions/search?q=coffee&cursor="+url.QueryEscape(*first.NextCursor), nil)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("other user cursor status=%d", bad.Code)
	}
	short := request("/api/transactions/search?q=co")
	for _, item := range short.Items {
		if item.ID == contains {
			t.Fatal("short query matched substring")
		}
	}
	filtered := request("/api/transactions/search?q=coffee&section=daily&kind=credit&from=2026-02-01&to=2026-02-01&min_amount=30&max_amount=30")
	if len(filtered.Items) != 1 || filtered.Items[0].ID != exactNew {
		t.Fatalf("filtered=%#v", filtered)
	}
	empty := request("/api/transactions/search?q=zzzzzzzzzz")
	if empty.Items == nil || len(empty.Items) != 0 || empty.HasMore || empty.NextCursor != nil {
		t.Fatalf("empty=%#v", empty)
	}
	// Literal wildcard searches must not return all names.
	literal := insertTransactionForSuggestionTest(t, pool, uid, "daily", "%_!", "cash")
	wildcard := request("/api/transactions/search?q=" + url.QueryEscape("%_!"))
	if len(wildcard.Items) != 1 || wildcard.Items[0].ID != literal.String() {
		t.Fatalf("wildcards=%#v", wildcard)
	}
	shortWildcard := request("/api/transactions/search?q=" + url.QueryEscape("%"))
	if len(shortWildcard.Items) != 1 {
		t.Fatalf("short wildcard=%#v", shortWildcard)
	}
	// The generated column follows renames without application synchronization.
	if _, err := pool.Exec(ctx, `UPDATE transactions SET category='Renamed' WHERE id=$1`, prefix); err != nil {
		t.Fatal(err)
	}
	renamed := request("/api/transactions/search?q=renamed")
	if len(renamed.Items) != 1 || renamed.Items[0].ID != prefix {
		t.Fatal("rename not searchable")
	}
	unauthorized := httptest.NewRecorder()
	srv.Router().ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/transactions/search?q=coffee", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatal("missing authentication")
	}
}

func TestTransactionSearchMigration(t *testing.T) {
	_, pool, _, uid := setupCategoryAPITest(t)
	defer pool.Close()
	ctx := context.Background()
	m := newSuggestionTestMigrator(t, pool.Config().ConnString())
	defer func() {
		if err := m.Up(); err != nil && err != migrate.ErrNoChange {
			t.Errorf("restore migration: %v", err)
		}
		m.Close()
	}()
	if err := m.Steps(-1); err != nil {
		t.Fatal(err)
	}
	id := insertTransactionForSuggestionTest(t, pool, uid, "daily", "  Coffee\t Shop  ", "cash")
	if err := m.Steps(1); err != nil {
		t.Fatal(err)
	}
	var name string
	if err := pool.QueryRow(ctx, `SELECT normalized_name FROM transactions WHERE id=$1`, id).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "coffee shop" {
		t.Fatalf("backfill name=%q", name)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_indexes WHERE indexname IN ('transactions_search_trgm_idx','transactions_search_prefix_idx')`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("indexes=%d", count)
	}
}
