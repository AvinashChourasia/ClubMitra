// Package users owns RunMitra's local PROFILE CACHE of MarathonMitra users.
// MarathonMitra (MongoDB) is the source of truth for identity; this table just
// mirrors the few fields we need (id, email, display_name) to label runs and
// leaderboards, refreshed on each login. There are no passwords here.
package users

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// User is the cached profile. ID is the MarathonMitra user id (a Mongo ObjectId
// string), which is why it's a string and every RunMitra table keys off it.
type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ErrNotFound is returned when no cached profile exists for an id.
var ErrNotFound = errors.New("user not found")

// Repository is the data-access layer for the user profile cache.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Upsert refreshes (or creates) the local profile from MarathonMitra. Called on
// login with the identity MarathonMitra returned. ON CONFLICT keeps a single row
// per MarathonMitra id and updates the cached fields + synced_at each time.
func (r *Repository) Upsert(ctx context.Context, id, email, displayName string) (*User, error) {
	const q = `
		INSERT INTO users (id, email, display_name, synced_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (id) DO UPDATE
			SET email = EXCLUDED.email,
			    display_name = EXCLUDED.display_name,
			    synced_at = now()
		RETURNING id, email, display_name, created_at, updated_at`
	var u User
	err := r.db.QueryRow(ctx, q, id, email, displayName).Scan(
		&u.ID, &u.Email, &u.DisplayName, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetByID looks up a cached profile by MarathonMitra id (used by /users/me).
func (r *Repository) GetByID(ctx context.Context, id string) (*User, error) {
	const q = `
		SELECT id, email, display_name, created_at, updated_at
		FROM users WHERE id = $1`
	var u User
	err := r.db.QueryRow(ctx, q, id).Scan(
		&u.ID, &u.Email, &u.DisplayName, &u.CreatedAt, &u.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// DisplayNames resolves many user ids to their display names in one query — used
// by the leaderboard to label ranked users without an N+1 of GetByID calls.
// = ANY($1) lets us pass a slice of ids as a single parameter.
func (r *Repository) DisplayNames(ctx context.Context, ids []string) (map[string]string, error) {
	out := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	const q = `SELECT id, display_name FROM users WHERE id = ANY($1)`
	rows, err := r.db.Query(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}
