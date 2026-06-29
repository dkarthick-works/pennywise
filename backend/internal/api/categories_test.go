package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	dbfs "github.com/ledger/backend/db"
	"github.com/ledger/backend/internal/auth"
	"github.com/ledger/backend/internal/config"
)

const categoryAPITestSecret = "category-api-test-secret"

func TestCategoryGroupWorkflow(t *testing.T) {
	srv, pool, token, userID := setupCategoryAPITest(t)
	defer pool.Close()

	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO transactions (user_id, section, category, amount, txn_date, kind)
		VALUES
			($1, 'daily', 'Amazon', 10, '2026-06-01', 'cash'),
			($1, 'daily', 'Uber', 12, '2026-06-02', 'cash')
	`, userID); err != nil {
		t.Fatalf("insert transactions: %v", err)
	}

	shopping := createGroup(t, srv, token, "Shopping")
	subscriptions := createGroup(t, srv, token, "Subscriptions")

	if len(shopping.Mappings) != 0 {
		t.Fatalf("new group mappings length = %d, want 0", len(shopping.Mappings))
	}

	mapCategory(t, srv, token, "Amazon", shopping.ID, http.StatusCreated, "")
	mapCategory(t, srv, token, "Amazon", subscriptions.ID, http.StatusCreated, "")
	mapCategory(t, srv, token, "Amazon", subscriptions.ID, http.StatusConflict, "that category text is already in this group")

	mapCategoryWithGroupName(t, srv, token, "Uber", "Shopping", http.StatusConflict, "a group with that name already exists")

	texts := listCategoryTexts(t, srv, token, "ama", "")
	if len(texts) != 1 || texts[0] != "Amazon" {
		t.Fatalf("texts = %#v, want [Amazon]", texts)
	}

	texts = listCategoryTexts(t, srv, token, "ama", shopping.ID)
	if len(texts) != 0 {
		t.Fatalf("excluded texts = %#v, want empty", texts)
	}
}

func setupCategoryAPITest(t *testing.T) (*Server, *pgxpool.Pool, string, uuid.UUID) {
	t.Helper()

	rawURL := os.Getenv("PENNYWISE_TEST_DATABASE_URL")
	if rawURL == "" {
		t.Skip("set PENNYWISE_TEST_DATABASE_URL to run category API integration tests")
	}

	ctx := context.Background()
	migrateTestDB(t, rawURL)

	pool, err := pgxpool.New(ctx, rawURL)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "TRUNCATE users CASCADE")
	})
	if _, err := pool.Exec(ctx, "TRUNCATE users CASCADE"); err != nil {
		pool.Close()
		t.Fatalf("clean test db: %v", err)
	}

	cfg := config.Config{
		JWTSecret:     categoryAPITestSecret,
		JWTUserClaim:  "sub",
		JWTEmailClaim: "email",
		GoauthBaseURL: "http://127.0.0.1:1",
		CORSOrigins:   []string{"http://localhost:5173"},
	}
	srv, err := NewServer(cfg, pool)
	if err != nil {
		pool.Close()
		t.Fatalf("new server: %v", err)
	}

	userID := uuid.New()
	if err := srv.provisionUser(ctx, auth.Identity{UserID: userID, Email: "category-test@example.com"}); err != nil {
		pool.Close()
		t.Fatalf("provision user: %v", err)
	}

	token := signedTestToken(t, userID)
	return srv, pool, token, userID
}

func migrateTestDB(t *testing.T, rawURL string) {
	t.Helper()

	src, err := iofs.New(dbfs.Migrations, "migrations")
	if err != nil {
		t.Fatalf("migration source: %v", err)
	}
	dsn := rawURL
	for _, p := range []string{"postgresql://", "postgres://"} {
		if rest, ok := strings.CutPrefix(dsn, p); ok {
			dsn = "pgx5://" + rest
			break
		}
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, dsn)
	if err != nil {
		t.Fatalf("new migrate: %v", err)
	}
	defer m.Close()
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("migrate up: %v", err)
	}
}

func signedTestToken(t *testing.T, userID uuid.UUID) string {
	t.Helper()

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":   userID.String(),
		"email": "category-test@example.com",
	}).SignedString([]byte(categoryAPITestSecret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return token
}

func createGroup(t *testing.T, srv *Server, token, name string) CategoryGroupDTO {
	t.Helper()

	rr := apiRequest(t, srv, token, http.MethodPost, "/api/category-groups", map[string]string{"name": name})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create group status = %d body = %s", rr.Code, rr.Body.String())
	}
	var out CategoryGroupDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode group: %v", err)
	}
	return out
}

func mapCategory(t *testing.T, srv *Server, token, rawCategory, groupID string, wantStatus int, wantErr string) {
	t.Helper()

	rr := apiRequest(t, srv, token, http.MethodPost, "/api/category-mappings", map[string]string{
		"raw_category": rawCategory,
		"group_id":     groupID,
	})
	assertCategoryAPIResponse(t, rr, wantStatus, wantErr)
}

func mapCategoryWithGroupName(t *testing.T, srv *Server, token, rawCategory, groupName string, wantStatus int, wantErr string) {
	t.Helper()

	rr := apiRequest(t, srv, token, http.MethodPost, "/api/category-mappings", map[string]string{
		"raw_category": rawCategory,
		"group_name":   groupName,
	})
	assertCategoryAPIResponse(t, rr, wantStatus, wantErr)
}

func listCategoryTexts(t *testing.T, srv *Server, token, q, excludeGroupID string) []string {
	t.Helper()

	path := "/api/categories/texts?q=" + q
	if excludeGroupID != "" {
		path += "&exclude_group_id=" + excludeGroupID
	}
	rr := apiRequest(t, srv, token, http.MethodGet, path, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list texts status = %d body = %s", rr.Code, rr.Body.String())
	}
	var out []string
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode texts: %v", err)
	}
	return out
}

func assertCategoryAPIResponse(t *testing.T, rr *httptest.ResponseRecorder, wantStatus int, wantErr string) {
	t.Helper()

	if rr.Code != wantStatus {
		t.Fatalf("status = %d body = %s, want %d", rr.Code, rr.Body.String(), wantStatus)
	}
	if wantErr == "" {
		return
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if body.Error != wantErr {
		t.Fatalf("error = %q, want %q", body.Error, wantErr)
	}
}

func apiRequest(t *testing.T, srv *Server, token, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var rbody *bytes.Reader
	if body == nil {
		rbody = bytes.NewReader(nil)
	} else {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		rbody = bytes.NewReader(payload)
	}
	req := httptest.NewRequest(method, path, rbody)
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	srv.Router().ServeHTTP(rr, req)
	return rr
}
