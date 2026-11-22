package api

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ledger/backend/internal/db"
)

const (
	adminDefaultLimit = 50
	adminMaxLimit     = 100
)

// Values shipped in code or example env files are public, so a token signed
// with one proves nothing and must never unlock cross-user data.
var placeholderJWTSecrets = map[string]struct{}{
	"":                                 {},
	"dev-shared-secret-change-me":      {},
	"change-me":                        {},
	"change-me-minimum-32-char-secret": {},
}

func isPlaceholderJWTSecret(secret string) bool {
	_, found := placeholderJWTSecrets[strings.TrimSpace(secret)]
	return found
}

// requireAdmin reads the flag from the database on every request so revocation
// takes effect immediately. Any failure denies access.
func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")

		if isPlaceholderJWTSecret(s.cfg.JWTSecret) {
			log.Printf("admin_unavailable reason=placeholder_jwt_secret path=%s", r.URL.Path)
			writeErr(w, http.StatusServiceUnavailable, "admin access is unavailable")
			return
		}

		uid := userID(r)
		isAdmin, err := s.q.GetUserIsAdmin(r.Context(), uid)
		if err != nil {
			log.Printf("admin_check_failed user_id=%s path=%s: %v", uid, r.URL.Path, err)
			writeErr(w, http.StatusInternalServerError, "could not verify admin access")
			return
		}
		if !isAdmin {
			log.Printf("admin_denied user_id=%s method=%s path=%s", uid, r.Method, r.URL.Path)
			writeErr(w, http.StatusForbidden, "admin access required")
			return
		}

		log.Printf("admin_access user_id=%s method=%s path=%s", uid, r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := parseAdminPage(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "limit must be 1-100 and offset must be 0 or greater")
		return
	}

	rows, err := s.q.ListAdminUsers(r.Context(), db.ListAdminUsersParams{Limit: limit, Offset: offset})
	if err != nil {
		log.Printf("admin list users: %v", err)
		writeErr(w, http.StatusInternalServerError, "could not load users")
		return
	}
	summary, err := s.q.GetAdminSummary(r.Context())
	if err != nil {
		log.Printf("admin summary: %v", err)
		writeErr(w, http.StatusInternalServerError, "could not load users")
		return
	}

	users := make([]AdminUserDTO, 0, len(rows))
	for _, row := range rows {
		users = append(users, AdminUserDTO{
			UserID:           row.ID.String(),
			Email:            row.Email,
			DisplayName:      row.DisplayName,
			JoinedAt:         row.CreatedAt.Time.UTC().Format(time.RFC3339),
			TransactionCount: row.TransactionCount,
		})
	}
	writeJSON(w, http.StatusOK, AdminUsersDTO{
		Users:             users,
		TotalUsers:        summary.TotalUsers,
		TotalTransactions: summary.TotalTransactions,
		Limit:             limit,
		Offset:            offset,
	})
}

func parseAdminPage(r *http.Request) (limit, offset int32, ok bool) {
	limit, offset = adminDefaultLimit, 0
	query := r.URL.Query()
	if raw := query.Get("limit"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || parsed < 1 || parsed > adminMaxLimit {
			return 0, 0, false
		}
		limit = int32(parsed)
	}
	if raw := query.Get("offset"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || parsed < 0 {
			return 0, 0, false
		}
		offset = int32(parsed)
	}
	return limit, offset, true
}
