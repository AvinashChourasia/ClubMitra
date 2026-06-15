// Package activitysync pulls a runner's activities from third-party trackers
// (Strava today; Garmin later) and feeds them through the SAME run pipeline as
// an in-app recording — so synced runs credit challenges, leaderboards, badges
// and streaks with zero downstream changes. This is the survey's #1 ask: 68% of
// runners won't switch recording apps, so their Strava runs must count here.
//
// The integration is OAuth read-only and DORMANT unless STRAVA_CLIENT_ID/SECRET
// are configured. Sync is poll-on-demand (connect / "sync now" / app focus),
// which is robust on a free-tier backend that sleeps — webhooks can come later.
package activitysync

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotConnected means the user has no stored connection for the provider.
var ErrNotConnected = errors.New("not connected")

// connection is a stored OAuth link (tokens are decrypted in memory only).
type connection struct {
	UserID       string
	Provider     string
	AthleteID    string
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
	LastSyncedAt *time.Time
}

// Repository is the data-access layer for connections + the de-dupe ledger.
// It encrypts/decrypts tokens transparently via the cryptor.
type Repository struct {
	db   *pgxpool.Pool
	cryp *cryptor
}

// NewRepository builds the store, deriving the token-encryption key from the
// given secret (the JWT secret in practice).
func NewRepository(db *pgxpool.Pool, secret string) (*Repository, error) {
	cryp, err := newCryptor(secret)
	if err != nil {
		return nil, err
	}
	return &Repository{db: db, cryp: cryp}, nil
}

// upsertConnection stores (or replaces) a provider connection, encrypting tokens.
func (r *Repository) upsertConnection(ctx context.Context, c connection) error {
	at, err := r.cryp.encrypt(c.AccessToken)
	if err != nil {
		return err
	}
	rt, err := r.cryp.encrypt(c.RefreshToken)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO oauth_connections (user_id, provider, athlete_id, access_token, refresh_token, expires_at, scope)
		VALUES ($1, $2, $3, $4, $5, $6, 'activity:read')
		ON CONFLICT (user_id, provider) DO UPDATE SET
			athlete_id = EXCLUDED.athlete_id, access_token = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at`
	_, err = r.db.Exec(ctx, q, c.UserID, c.Provider, c.AthleteID, at, rt, c.ExpiresAt)
	return err
}

// getConnection loads + decrypts a connection, or ErrNotConnected.
func (r *Repository) getConnection(ctx context.Context, userID, provider string) (*connection, error) {
	const q = `
		SELECT athlete_id, access_token, refresh_token, expires_at, last_synced_at
		FROM oauth_connections WHERE user_id = $1 AND provider = $2`
	var c connection
	c.UserID, c.Provider = userID, provider
	var at, rt string
	err := r.db.QueryRow(ctx, q, userID, provider).Scan(&c.AthleteID, &at, &rt, &c.ExpiresAt, &c.LastSyncedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotConnected
	}
	if err != nil {
		return nil, err
	}
	if c.AccessToken, err = r.cryp.decrypt(at); err != nil {
		return nil, err
	}
	if c.RefreshToken, err = r.cryp.decrypt(rt); err != nil {
		return nil, err
	}
	return &c, nil
}

// updateTokens persists refreshed tokens (after a token refresh).
func (r *Repository) updateTokens(ctx context.Context, userID, provider, access, refresh string, expiresAt time.Time) error {
	at, err := r.cryp.encrypt(access)
	if err != nil {
		return err
	}
	rt, err := r.cryp.encrypt(refresh)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(ctx,
		`UPDATE oauth_connections SET access_token=$3, refresh_token=$4, expires_at=$5 WHERE user_id=$1 AND provider=$2`,
		userID, provider, at, rt, expiresAt)
	return err
}

func (r *Repository) markSynced(ctx context.Context, userID, provider string, at time.Time) error {
	_, err := r.db.Exec(ctx,
		`UPDATE oauth_connections SET last_synced_at=$3 WHERE user_id=$1 AND provider=$2`, userID, provider, at)
	return err
}

func (r *Repository) deleteConnection(ctx context.Context, userID, provider string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM oauth_connections WHERE user_id=$1 AND provider=$2`, userID, provider)
	return err
}

// alreadyImported reports whether an external activity was already pulled.
func (r *Repository) alreadyImported(ctx context.Context, provider, externalID string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM external_activities WHERE provider=$1 AND external_id=$2)`,
		provider, externalID).Scan(&exists)
	return exists, err
}

// recordImport writes the de-dupe ledger row. activityID is nil when the
// external run was skipped (e.g. it duplicated an in-app recording) — we still
// record it so we never reconsider it on the next sync.
func (r *Repository) recordImport(ctx context.Context, provider, externalID, userID string, activityID *uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO external_activities (provider, external_id, user_id, activity_id)
		 VALUES ($1,$2,$3,$4) ON CONFLICT (provider, external_id) DO NOTHING`,
		provider, externalID, userID, activityID)
	return err
}
