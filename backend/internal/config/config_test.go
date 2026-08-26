package config

import (
	"testing"
	"time"
)

func TestLoadOpenRouterConfig(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "key")
	t.Setenv("OPENROUTER_MODEL", "model")
	t.Setenv("OPENROUTER_BASE_URL", "https://example.test/v1/")
	t.Setenv("OPENROUTER_TIMEOUT", "7s")
	t.Setenv("OPENROUTER_SITE_URL", "https://pennywise.test")
	t.Setenv("OPENROUTER_APP_NAME", "Pennywise Test")

	cfg := Load()
	if cfg.OpenRouterAPIKey != "key" || cfg.OpenRouterModel != "model" {
		t.Fatalf("credentials not loaded: %#v", cfg)
	}
	if cfg.OpenRouterBaseURL != "https://example.test/v1" {
		t.Fatalf("base URL = %q", cfg.OpenRouterBaseURL)
	}
	if cfg.OpenRouterTimeout != 7*time.Second {
		t.Fatalf("timeout = %s", cfg.OpenRouterTimeout)
	}
	if cfg.OpenRouterSiteURL != "https://pennywise.test" || cfg.OpenRouterAppName != "Pennywise Test" {
		t.Fatalf("attribution settings not loaded: %#v", cfg)
	}
}

func TestInvalidOpenRouterTimeoutUsesDefault(t *testing.T) {
	t.Setenv("OPENROUTER_TIMEOUT", "not-a-duration")
	if got := Load().OpenRouterTimeout; got != 15*time.Second {
		t.Fatalf("timeout = %s, want 15s", got)
	}
}
