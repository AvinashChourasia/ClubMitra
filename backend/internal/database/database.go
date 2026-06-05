// Package database owns the connection to PostgreSQL.
//
// We use pgxpool: a pool of reusable connections. Opening a Postgres connection
// is expensive (TCP handshake + auth + TLS), so instead of opening one per
// request we keep a pool open and borrow/return connections. pgx is the most
// popular, actively maintained Postgres driver for Go and exposes Postgres
// features (like the geometry types we'll need later) better than database/sql.
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a connection pool and verifies it actually works.
//
// It takes a context so the caller controls how long to wait before giving up
// (e.g. on startup we don't want to hang forever if the DB is down).
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	// ParseConfig lets us tune the pool. The URL already carries host/user/db.
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	// Sensible pool limits for local dev. On a small host, too many connections
	// can overwhelm Postgres, so we cap them.
	cfg.MaxConns = 10
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	// NewWithConfig is lazy — it doesn't actually connect until the first query.
	// Ping forces a real connection now so we fail fast on startup if the DB is
	// unreachable, instead of on the first user request.
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}
