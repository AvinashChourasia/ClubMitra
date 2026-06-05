package auth

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StoredRefreshToken mirrors a row in the refresh_tokens table.
// RevokedAt is a pointer so it can represent SQL NULL (nil = not revoked).
type StoredRefreshToken struct {
	ID        uuid.UUID // RunMitra-generated; stays a uuid
	UserID    string    // MarathonMitra user id (ObjectId text)
	TokenHash string
	ExpiresAt time.Time
	RevokedAt *time.Time
	CreatedAt time.Time
}

// IsActive reports whether the token can still be used: not revoked and not
// past its expiry. Centralizing this check avoids subtle bugs at call sites.
func (t *StoredRefreshToken) IsActive() bool {
	return t.RevokedAt == nil && time.Now().Before(t.ExpiresAt)
}

// ErrRefreshNotFound is returned when no row matches a token hash.
var ErrRefreshNotFound = errors.New("refresh token not found")

// RefreshRepository is the data-access layer for refresh tokens.
type RefreshRepository struct {
	db *pgxpool.Pool
}

// NewRefreshRepository wires the repository to a connection pool.
func NewRefreshRepository(db *pgxpool.Pool) *RefreshRepository {
	return &RefreshRepository{db: db}
}

// Store saves a new refresh token (by its hash) for a user.
func (r *RefreshRepository) Store(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error {
	const q = `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)`
	_, err := r.db.Exec(ctx, q, userID, tokenHash, expiresAt)
	return err
}

// GetByHash finds a stored token by its hash, or ErrRefreshNotFound.
func (r *RefreshRepository) GetByHash(ctx context.Context, tokenHash string) (*StoredRefreshToken, error) {
	const q = `
		SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
		FROM refresh_tokens WHERE token_hash = $1`
	var t StoredRefreshToken
	err := r.db.QueryRow(ctx, q, tokenHash).Scan(
		&t.ID, &t.UserID, &t.TokenHash, &t.ExpiresAt, &t.RevokedAt, &t.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRefreshNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// Revoke marks a single token as revoked (idempotent: revoking twice is fine).
func (r *RefreshRepository) Revoke(ctx context.Context, id uuid.UUID) error {
	const q = `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`
	_, err := r.db.Exec(ctx, q, id)
	return err
}

// RevokeAllForUser revokes every active token for a user (used on a detected
// token-reuse attack, or "log out everywhere").
func (r *RefreshRepository) RevokeAllForUser(ctx context.Context, userID string) error {
	const q = `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`
	_, err := r.db.Exec(ctx, q, userID)
	return err
}
