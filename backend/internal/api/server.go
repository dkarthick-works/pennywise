package api

import (
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

		pr.Get("/api/templates", s.handleGetTemplates)
		pr.Put("/api/templates/{section}", s.handlePutTemplates)

		pr.Get("/api/transactions", s.handleListTransactions)
		pr.Post("/api/transactions", s.handleCreateTransaction)
		pr.Patch("/api/transactions/{id}", s.handleUpdateTransaction)
		pr.Delete("/api/transactions/{id}", s.handleDeleteTransaction)

		pr.Get("/api/sections/{section}/open-credits", s.handleOpenCredits)
		pr.Get("/api/daily-suggestions", s.handleDailySuggestions)
		pr.Get("/api/income-suggestions", s.handleIncomeSuggestions)
		pr.Get("/api/insights", s.handleGetInsights)

		pr.Get("/api/categories/unmapped", s.handleListUnmappedCategories)
		pr.Get("/api/category-groups", s.handleListCategoryGroups)
		pr.Post("/api/category-groups", s.handleCreateCategoryGroup)
		pr.Patch("/api/category-groups/{id}", s.handleUpdateCategoryGroup)
		pr.Delete("/api/category-groups/{id}", s.handleDeleteCategoryGroup)

		pr.Get("/api/category-mappings", s.handleListCategoryMappings)
		pr.Post("/api/category-mappings", s.handleCreateCategoryMapping)
		pr.Patch("/api/category-mappings/{id}", s.handleUpdateCategoryMapping)
		pr.Delete("/api/category-mappings/{id}", s.handleDeleteCategoryMapping)

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
			r.URL.Path = "/"
		}
		fserver.ServeHTTP(w, r)
	})
}
