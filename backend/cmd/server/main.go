package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/ledger/backend/internal/api"
	"github.com/ledger/backend/internal/config"
	"github.com/ledger/backend/internal/database"
	"github.com/ledger/backend/internal/transactionparser"
)

func main() {
	// Load .env if present (silently ignored in production where real env vars are set).
	_ = godotenv.Load()

	cfg := config.Load()
	ctx := context.Background()

	log.Println("running migrations…")
	if err := database.Migrate(ctx, cfg.DatabaseURL); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	var parser transactionparser.Parser
	switch {
	case cfg.OpenRouterAPIKey == "" && cfg.OpenRouterModel == "":
		log.Println("AI transaction parsing disabled: OPENROUTER_API_KEY and OPENROUTER_MODEL are not set")
	case cfg.OpenRouterAPIKey == "" || cfg.OpenRouterModel == "":
		log.Fatal("AI transaction parsing configuration requires both OPENROUTER_API_KEY and OPENROUTER_MODEL")
	default:
		parser, err = transactionparser.NewOpenRouterParser(transactionparser.OpenRouterConfig{
			APIKey: cfg.OpenRouterAPIKey, Model: cfg.OpenRouterModel, BaseURL: cfg.OpenRouterBaseURL,
			Timeout: cfg.OpenRouterTimeout, SiteURL: cfg.OpenRouterSiteURL, AppName: cfg.OpenRouterAppName,
		})
		if err != nil {
			log.Fatalf("OpenRouter: %v", err)
		}
	}

	srv, err := api.NewServerWithTransactionParser(cfg, pool, parser)
	if err != nil {
		log.Fatalf("server: %v", err)
	}

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("pennywise api listening on :%s", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
}
