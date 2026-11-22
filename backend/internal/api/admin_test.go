package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ledger/backend/internal/auth"
)

func TestPlaceholderJWTSecrets(t *testing.T) {
	for _, secret := range []string{"", " ", "dev-shared-secret-change-me", "change-me", " change-me ", "change-me-minimum-32-char-secret"} {
		if !isPlaceholderJWTSecret(secret) {
			t.Errorf("%q should be a placeholder", secret)
		}
	}
	if isPlaceholderJWTSecret("a-real-production-secret-value-123456") {
		t.Error("real secret flagged as placeholder")
	}
}

func TestParseAdminPage(t *testing.T) {
	tests := []struct {
		query         string
		limit, offset int32
		ok            bool
	}{
		{"", 50, 0, true},
		{"?limit=1&offset=10", 1, 10, true},
		{"?limit=100", 100, 0, true},
		{"?limit=0", 0, 0, false},
		{"?limit=101", 0, 0, false},
		{"?limit=abc", 0, 0, false},
		{"?offset=-1", 0, 0, false},
		{"?offset=99999999999", 0, 0, false},
	}
	for _, tc := range tests {
		req := httptest.NewRequest(http.MethodGet, "/api/admin/users"+tc.query, nil)
		limit, offset, ok := parseAdminPage(req)
		if limit != tc.limit || offset != tc.offset || ok != tc.ok {
			t.Errorf("%q = %d,%d,%v", tc.query, limit, offset, ok)
		}
	}
}

func setAdmin(t *testing.T, pool *pgxpool.Pool, id uuid.UUID, value bool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `UPDATE users SET is_admin = $2 WHERE id = $1`, id, value); err != nil {
		t.Fatal(err)
	}
}

func decodeAdminUsers(t *testing.T, rr *httptest.ResponseRecorder) AdminUsersDTO {
	t.Helper()
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body)
	}
	var out AdminUsersDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestAdminAccessLifecycle(t *testing.T) {
	srv, pool, token, owner := setupCategoryAPITest(t)
	defer pool.Close()

	if r := apiRequest(t, srv, "", http.MethodGet, "/api/admin/users", nil); r.Code != http.StatusUnauthorized {
		t.Fatalf("no token = %d", r.Code)
	}
	r := apiRequest(t, srv, token, http.MethodGet, "/api/admin/users", nil)
	if r.Code != http.StatusForbidden {
		t.Fatalf("non-admin = %d", r.Code)
	}
	if got := r.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("403 Cache-Control = %q", got)
	}

	// A user must not be able to promote themselves through the profile API.
	selfPromote := map[string]any{"display_name": "x", "email": "x@example.com", "is_admin": true}
	if r := apiRequest(t, srv, token, http.MethodPut, "/api/profile", selfPromote); r.Code != http.StatusBadRequest {
		t.Fatalf("self-promotion = %d", r.Code)
	}

	setAdmin(t, pool, owner, true)
	r = apiRequest(t, srv, token, http.MethodGet, "/api/admin/users", nil)
	decodeAdminUsers(t, r)
	if got := r.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("200 Cache-Control = %q", got)
	}

	// The upsert run on every request must not clear the flag.
	var me ProfileDTO
	r = apiRequest(t, srv, token, http.MethodGet, "/api/me", nil)
	if err := json.Unmarshal(r.Body.Bytes(), &me); err != nil || !me.IsAdmin {
		t.Fatalf("/api/me = %s, %v", r.Body, err)
	}
	var saved ProfileDTO
	r = apiRequest(t, srv, token, http.MethodPut, "/api/profile", map[string]any{"display_name": "Owner", "email": "owner@example.com"})
	if err := json.Unmarshal(r.Body.Bytes(), &saved); err != nil || !saved.IsAdmin {
		t.Fatalf("profile save = %s, %v", r.Body, err)
	}

	setAdmin(t, pool, owner, false)
	if r := apiRequest(t, srv, token, http.MethodGet, "/api/admin/users", nil); r.Code != http.StatusForbidden {
		t.Fatalf("revoked admin with same token = %d", r.Code)
	}
}

func TestAdminUnavailableWithPlaceholderSecret(t *testing.T) {
	srv, pool, token, owner := setupCategoryAPITest(t)
	defer pool.Close()
	setAdmin(t, pool, owner, true)

	srv.cfg.JWTSecret = "change-me"
	if r := apiRequest(t, srv, token, http.MethodGet, "/api/admin/users", nil); r.Code != http.StatusServiceUnavailable {
		t.Fatalf("placeholder secret = %d", r.Code)
	}
}

func TestAdminUsersCountsAndPagination(t *testing.T) {
	srv, pool, token, owner := setupCategoryAPITest(t)
	defer pool.Close()
	ctx := context.Background()
	setAdmin(t, pool, owner, true)

	busy, empty := uuid.New(), uuid.New()
	for _, u := range []struct {
		id    uuid.UUID
		email string
	}{{busy, "busy@example.com"}, {empty, "empty@example.com"}} {
		if err := srv.provisionUser(ctx, auth.Identity{UserID: u.id, Email: u.email}); err != nil {
			t.Fatal(err)
		}
	}
	// All three share created_at so ordering must fall back to id.
	if _, err := pool.Exec(ctx, `UPDATE users SET created_at = '2026-01-01T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO transactions (user_id, section, category, amount, txn_date, kind) VALUES
		($1, 'daily', 'Coffee', 10, '2026-01-02', 'cash'),
		($1, 'daily', 'Card', 20, '2026-01-03', 'credit'),
		($1, 'essential', 'Blank template', 0, '2026-01-01', 'cash')`, busy); err != nil {
		t.Fatal(err)
	}

	all := decodeAdminUsers(t, apiRequest(t, srv, token, http.MethodGet, "/api/admin/users", nil))
	if all.TotalUsers != 3 || all.TotalTransactions != 2 || len(all.Users) != 3 {
		t.Fatalf("summary = %+v", all)
	}
	counts := map[string]int64{}
	for _, u := range all.Users {
		counts[u.UserID] = u.TransactionCount
	}
	if counts[busy.String()] != 2 || counts[empty.String()] != 0 {
		t.Fatalf("counts = %v", counts)
	}

	// Totals stay global on a partial page, and pages neither repeat nor skip.
	seen := map[string]bool{}
	for offset := range 3 {
		page := decodeAdminUsers(t, apiRequest(t, srv, token, http.MethodGet, fmt.Sprintf("/api/admin/users?limit=1&offset=%d", offset), nil))
		if len(page.Users) != 1 || page.TotalUsers != 3 || page.TotalTransactions != 2 {
			t.Fatalf("page %d = %+v", offset, page)
		}
		if page.Users[0].UserID != all.Users[offset].UserID || seen[page.Users[0].UserID] {
			t.Fatalf("unstable page %d", offset)
		}
		seen[page.Users[0].UserID] = true
	}

	if r := apiRequest(t, srv, token, http.MethodGet, "/api/admin/users?limit=500", nil); r.Code != http.StatusBadRequest {
		t.Fatalf("oversized limit = %d", r.Code)
	}
}
