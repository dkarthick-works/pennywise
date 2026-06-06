// Command seed plants the default templates + demo dataset for a given user id.
// Useful for populating an existing account outside the first-login flow.
//
//	go run ./cmd/seed -user <uuid> [-email someone@example.com] [-demo=false]
package main

import (
	"context"
	"flag"
	"log"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/config"
	"github.com/ledger/backend/internal/database"
	"github.com/ledger/backend/internal/db"
	"github.com/ledger/backend/internal/seed"
)

func main() {
	userFlag := flag.String("user", "", "user UUID to seed (required)")
	email := flag.String("email", "demo@ledger.app", "email to attach to the user")
	demo := flag.Bool("demo", true, "include the demo transaction dataset")
	flag.Parse()

	uid, err := uuid.Parse(*userFlag)
	if err != nil {
		log.Fatalf("invalid -user uuid: %v", err)
	}

	cfg := config.Load()
	ctx := context.Background()
	if err := database.Migrate(ctx, cfg.DatabaseURL); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	q := db.New(pool)
	tx, err := pool.Begin(ctx)
	if err != nil {
		log.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)
	qtx := q.WithTx(tx)

	if _, err := qtx.UpsertUser(ctx, db.UpsertUserParams{ID: uid, Email: *email}); err != nil {
		log.Fatalf("upsert user: %v", err)
	}
	if _, err := qtx.EnsureSettings(ctx, uid); err != nil {
		// ignore "already exists" (no row returned) — only fail on real errors
		log.Printf("ensure settings: %v (continuing)", err)
	}
	if err := seed.SeedTemplates(ctx, qtx, uid); err != nil {
		log.Fatalf("seed templates: %v", err)
	}
	if *demo {
		if err := seed.SeedDemoData(ctx, qtx, uid); err != nil {
			log.Fatalf("seed demo: %v", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("commit: %v", err)
	}
	log.Printf("seeded user %s (demo=%v)", uid, *demo)
}
