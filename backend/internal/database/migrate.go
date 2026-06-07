package database

import (
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver

	appdb "github.com/avinash/clubmitra/backend/db"
)

// Migrate applies any pending migrations on startup.
//
// Why run migrations from the app instead of a manual `make migrate-up`? In
// production (Render), each deploy starts a fresh container — having the binary
// migrate itself means a deploy can never run against an out-of-date schema, and
// there's no separate step to forget. goose records applied versions in
// goose_db_version, so re-running is a safe no-op when nothing is pending.
//
// goose uses the standard database/sql interface (not pgx's native pool), so we
// open a short-lived *sql.DB via the pgx stdlib driver just for this, then close
// it. The app itself keeps using the pgxpool for queries.
func Migrate(databaseURL string) error {
	sqlDB, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open db for migrations: %w", err)
	}
	defer sqlDB.Close()

	goose.SetBaseFS(appdb.FS) // read migrations from the embedded files
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("set goose dialect: %w", err)
	}
	if err := goose.Up(sqlDB, "migrations"); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	return nil
}
