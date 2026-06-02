package config

import (
	"os"
	"strings"
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
}

func Load() Config {
	return Config{
		Port:          env("PORT", "8080"),
		DatabaseURL:   env("DATABASE_URL", "postgres://ledger:ledger@localhost:5432/ledger?sslmode=disable"),
		JWTSecret:     env("JWT_SECRET", "dev-shared-secret-change-me"),
		JWTUserClaim:  env("JWT_USER_CLAIM", "sub"),
		JWTEmailClaim: env("JWT_EMAIL_CLAIM", "email"),
		GoauthBaseURL: strings.TrimRight(env("GOAUTH_BASE_URL", "http://localhost:8090"), "/"),
		CORSOrigins:   splitCSV(env("CORS_ORIGINS", "http://localhost:5173")),
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
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
