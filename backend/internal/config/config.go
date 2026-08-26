package config

import (
	"os"
	"strings"
	"time"
)

// Config holds all runtime configuration, loaded from the environment.
type Config struct {
	Port        string
	DatabaseURL string

	// JWT validation — we verify Goauth's access tokens locally with the
	// shared HS256 secret and read the user id from a claim.
	JWTSecret     string
	JWTUserClaim  string // claim holding the user UUID (e.g. "user_id" or "sub")
	JWTEmailClaim string

	// Goauth service we proxy auth requests to.
	GoauthBaseURL string

	// Comma-separated list of allowed CORS origins for the SPA.
	CORSOrigins []string

	// OpenRouter powers natural-language transaction previews. An empty key or
	// model leaves only that endpoint disabled while the rest of the API runs.
	OpenRouterAPIKey  string
	OpenRouterModel   string
	OpenRouterBaseURL string
	OpenRouterTimeout time.Duration
	OpenRouterSiteURL string
	OpenRouterAppName string
}

func Load() Config {
	return Config{
		Port:              env("PORT", "8080"),
		DatabaseURL:       env("DATABASE_URL", "postgres://ledger:ledger@localhost:5432/ledger?sslmode=disable"),
		JWTSecret:         env("JWT_SECRET", "dev-shared-secret-change-me"),
		JWTUserClaim:      env("JWT_USER_CLAIM", "sub"),
		JWTEmailClaim:     env("JWT_EMAIL_CLAIM", "email"),
		GoauthBaseURL:     strings.TrimRight(env("GOAUTH_BASE_URL", "http://localhost:8090"), "/"),
		CORSOrigins:       splitCSV(env("CORS_ORIGINS", "http://localhost:5173")),
		OpenRouterAPIKey:  env("OPENROUTER_API_KEY", ""),
		OpenRouterModel:   env("OPENROUTER_MODEL", ""),
		OpenRouterBaseURL: strings.TrimRight(env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"), "/"),
		OpenRouterTimeout: envDuration("OPENROUTER_TIMEOUT", 15*time.Second),
		OpenRouterSiteURL: env("OPENROUTER_SITE_URL", ""),
		OpenRouterAppName: env("OPENROUTER_APP_NAME", "Pennywise"),
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return def
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return def
	}
	return parsed
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
