package api

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ledger/backend/internal/auth"
	"github.com/ledger/backend/internal/config"
	"github.com/ledger/backend/internal/db"
	"github.com/ledger/backend/web"
)

// Server wires together config, the database, and auth into an http.Handler.
type Server struct {
	cfg      config.Config
	pool     *pgxpool.Pool
	q        *db.Queries
	verifier *auth.Verifier
	proxy    *auth.Proxy
}

func NewServer(cfg config.Config, pool *pgxpool.Pool) (*Server, error) {
	proxy, err := auth.NewProxy(cfg.GoauthBaseURL)
	if err != nil {
		return nil, err
	}
	return &Server{
		cfg:      cfg,
		pool:     pool,
		q:        db.New(pool),
		verifier: auth.NewVerifier(cfg.JWTSecret, cfg.JWTUserClaim, cfg.JWTEmailClaim),
		proxy:    proxy,
	}, nil
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/health", s.handleHealth)

	// Auth endpoints are proxied straight to Goauth (no local JWT required).
	r.Handle("/api/auth/*", s.proxy.Handler())

	// Everything else requires a valid access token, and ensures the user row
	// (+ default settings + optional demo seed) exists.
	r.Group(func(pr chi.Router) {
		pr.Use(s.verifier.Middleware)
		pr.Use(s.ensureUser)

		pr.Get("/api/me", s.handleMe)
		pr.Get("/api/profile", s.handleGetProfile)
		pr.Put("/api/profile", s.handleUpdateProfile)

		pr.Get("/api/settings", s.handleGetSettings)
		pr.Put("/api/settings/budgets", s.handleUpdateBudgets)
		pr.Put("/api/settings/preferences", s.handleUpdatePreferences)
		pr.Put("/api/settings/credit-billing-cycle", s.handleUpdateCreditStatementDay)
		pr.Put("/api/settings/credit-spending-threshold", s.handleUpdateCreditSpendingThreshold)

		pr.Get("/api/templates", s.handleGetTemplates)
		pr.Put("/api/templates/{section}", s.handlePutTemplates)

		pr.Get("/api/transactions", s.handleListTransactions)
		pr.Get("/api/transactions/export", s.handleExportTransactions)
		pr.Post("/api/transactions/import", s.handleImportTransactions)
		pr.Post("/api/transactions", s.handleCreateTransaction)
		pr.Patch("/api/transactions/{id}", s.handleUpdateTransaction)
		pr.Delete("/api/transactions/{id}", s.handleDeleteTransaction)
		pr.Get("/api/transaction-names/suggestions", s.handleTransactionNameSuggestions)

		pr.Get("/api/sections/{section}/open-credits", s.handleOpenCredits)
		pr.Get("/api/daily-suggestions", s.handleDailySuggestions)
		pr.Get("/api/income-suggestions", s.handleIncomeSuggestions)
		pr.Get("/api/insights", s.handleGetInsights)
		pr.Get("/api/dashboard/monthly", s.handleGetDashboardMonthly)
		pr.Get("/api/dashboard/group-spend", s.handleGetGroupSpend)
		pr.Get("/api/dashboard/credit-usage", s.handleGetCreditUsage)
		pr.Get("/api/dashboard/credit-transactions", s.handleGetCreditTransactions)

		pr.Get("/api/categories/unmapped", s.handleListUnmappedCategories)
		pr.Get("/api/categories/texts", s.handleListTransactionCategoryTexts)
		pr.Get("/api/category-groups", s.handleListCategoryGroups)
		pr.Get("/api/category-groups/{id}/transactions", s.handleGetCategoryGroupTransactions)
		pr.Post("/api/category-groups", s.handleCreateCategoryGroup)
		pr.Patch("/api/category-groups/{id}", s.handleUpdateCategoryGroup)
		pr.Delete("/api/category-groups/{id}", s.handleDeleteCategoryGroup)

		pr.Get("/api/category-mappings", s.handleListCategoryMappings)
		pr.Post("/api/category-mappings", s.handleCreateCategoryMapping)
		pr.Delete("/api/category-mappings/{id}", s.handleDeleteCategoryMapping)

		pr.Get("/api/lents", s.handleListLents)
		pr.Post("/api/lents", s.handleCreateLent)
		pr.Get("/api/lents/{id}", s.handleGetLent)
		pr.Patch("/api/lents/{id}", s.handleUpdateLent)
		pr.Delete("/api/lents/{id}", s.handleDeleteLent)

		pr.Get("/api/lents/{id}/repayments", s.handleListRepayments)
		pr.Post("/api/lents/{id}/repayments", s.handleCreateRepayment)
		pr.Patch("/api/lents/{id}/repayments/{rid}", s.handleUpdateRepayment)
		pr.Delete("/api/lents/{id}/repayments/{rid}", s.handleDeleteRepayment)

		pr.Get("/api/chits", s.handleListChits)
		pr.Post("/api/chits", s.handleCreateChit)
		pr.Get("/api/chits/{id}", s.handleGetChit)
		pr.Patch("/api/chits/{id}", s.handleUpdateChit)
		pr.Delete("/api/chits/{id}", s.handleDeleteChit)
		pr.Post("/api/chits/{id}/installments", s.handleCreateChitInstallment)
		pr.Patch("/api/chits/{id}/installments/{installmentId}", s.handleUpdateChitInstallment)
		pr.Delete("/api/chits/{id}/installments/{installmentId}", s.handleDeleteChitInstallment)

		pr.Get("/api/months/{month}", s.handleGetMonth)
		pr.Put("/api/months/{month}/closed", s.handleSetMonthClosed)
		pr.Post("/api/months/{month}/open", s.handleOpenMonth)
	})

	if web.FS != nil {
		r.Handle("/*", spaHandler(web.FS))
	}

	return r
}

// ---- shared helpers -------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	status := "ok"
	code := http.StatusOK
	if err := s.pool.Ping(r.Context()); err != nil {
		status, code = "db unavailable", http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]string{"status": status})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.FromContext(r.Context())
	u, err := s.q.GetUser(r.Context(), id.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load user")
		return
	}
	writeJSON(w, http.StatusOK, ProfileDTO{UserID: u.ID.String(), Email: u.Email, DisplayName: u.DisplayName})
}

func userID(r *http.Request) uuid.UUID {
	id, _ := auth.FromContext(r.Context())
	return id.UserID
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func writeCSV(w http.ResponseWriter, filename string, rows [][]string) error {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.WriteHeader(http.StatusOK)

	if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return err
	}
	cw := csv.NewWriter(w)
	if err := cw.WriteAll(rows); err != nil {
		return err
	}
	return cw.Error()
}

func readJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return errors.New("invalid request body")
	}
	return nil
}

func init() {
	// Go does not register the PWA manifest extension by default; without this
	// the service worker manifest is served as a sniffed type.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func spaHandler(fsys fs.FS) http.Handler {
	fserver := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if _, err := fsys.Open(name); err != nil {
			name = "index.html"
			r.URL.Path = "/"
		}

		// HTML and service-worker entry points must be revalidated so a new
		// deployment can be discovered immediately. Vite's content-hashed build
		// assets are immutable and safe to cache for a year.
		switch {
		case name == "index.html", name == "sw.js", name == "registerSW.js":
			w.Header().Set("Cache-Control", "no-cache")
		case strings.HasPrefix(name, "assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}

		fserver.ServeHTTP(w, r)
	})
}
