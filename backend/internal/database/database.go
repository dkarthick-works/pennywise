// Package database handles the Postgres connection pool and migrations.
package database

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	dbfs "github.com/ledger/backend/db"
)

const appDatabase = "pennywise"

// ensureAppDatabase connects to the URL as-is, creates appDatabase if it
// doesn't exist, then returns a URL pointing at appDatabase.
func ensureAppDatabase(ctx context.Context, rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("parse url: %w", err)
	}
	if strings.TrimPrefix(u.Path, "/") == appDatabase {
		return rawURL, nil
	}

	conn, err := pgx.Connect(ctx, rawURL)
	if err != nil {
		return "", fmt.Errorf("bootstrap connect: %w", err)
	}
	defer conn.Close(ctx)

	var exists bool
	err = conn.QueryRow(ctx,
		"SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)", appDatabase,
	).Scan(&exists)
	if err != nil {
		return "", fmt.Errorf("check db existence: %w", err)
	}
	if !exists {
		if _, err := conn.Exec(ctx, "CREATE DATABASE "+appDatabase); err != nil {
			return "", fmt.Errorf("create database %s: %w", appDatabase, err)
		}
	}

	u.Path = "/" + appDatabase
	return u.String(), nil
}

// Connect opens a pgx connection pool and verifies it with a ping.
func Connect(ctx context.Context, rawURL string) (*pgxpool.Pool, error) {
	appURL, err := ensureAppDatabase(ctx, rawURL)
	if err != nil {
		return nil, err
	}

	cfg, err := pgxpool.ParseConfig(appURL)
	if err != nil {
		return nil, err
	}
	cfg.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// Migrate applies all up migrations embedded in the binary.
func Migrate(ctx context.Context, rawURL string) error {
	appURL, err := ensureAppDatabase(ctx, rawURL)
	if err != nil {
		return err
	}

	src, err := iofs.New(dbfs.Migrations, "migrations")
	if err != nil {
		return err
	}
	dsn := appURL
	for _, p := range []string{"postgresql://", "postgres://"} {
		if rest, ok := strings.CutPrefix(dsn, p); ok {
			dsn = "pgx5://" + rest
			break
		}
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, dsn)
	if err != nil {
		return err
	}
	defer m.Close()
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return err
	}
	return nil
}
