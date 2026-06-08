package trust

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a user row is missing.
var ErrNotFound = errors.New("not found")

// Stats are the raw inputs to the score, read from a user's proof history and
// account age. Rates are derived in Snapshot/Recompute, not here.
type Stats struct {
	TotalProofs    int
	NonManualProof int
	ApprovedProofs int
	AccountAgeDays int
}

// Snapshot is the public view of a user's trust standing.
type Snapshot struct {
	Score          float64 `json:"trust_score"`
	Tier           string  `json:"trust_tier"`
	SubmissionRate float64 `json:"submission_rate"` // 0..1
	ApprovalRate   float64 `json:"approval_rate"`   // 0..1
	AccountAgeDays int     `json:"account_age_days"`
	TotalProofs    int     `json:"total_proofs"`
}

// Repository is the trust data-access layer.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// stats gathers a user's proof counts and account age in one round-trip. A
// missing user returns ErrNotFound.
func (r *Repository) stats(ctx context.Context, userID string) (Stats, float64, string, error) {
	const q = `
		SELECT
		  u.trust_score,
		  u.trust_tier,
		  GREATEST(0, (EXTRACT(EPOCH FROM now() - u.created_at) / 86400))::int AS age_days,
		  (SELECT count(*) FROM challenge_proof p
		     WHERE p.user_id = u.id AND p.deleted_at IS NULL) AS total,
		  (SELECT count(*) FROM challenge_proof p
		     WHERE p.user_id = u.id AND p.deleted_at IS NULL AND p.submission_method <> 'manual') AS non_manual,
		  (SELECT count(*) FROM challenge_proof p
		     WHERE p.user_id = u.id AND p.deleted_at IS NULL AND p.verified) AS approved
		FROM users u
		WHERE u.id = $1 AND u.deleted_at IS NULL`
	var s Stats
	var curScore float64
	var curTier string
	err := r.db.QueryRow(ctx, q, userID).Scan(
		&curScore, &curTier, &s.AccountAgeDays, &s.TotalProofs, &s.NonManualProof, &s.ApprovedProofs,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Stats{}, 0, "", ErrNotFound
	}
	if err != nil {
		return Stats{}, 0, "", fmt.Errorf("trust stats: %w", err)
	}
	return s, curScore, curTier, nil
}

// score reads a user's current trust score (cheap lookup for routing decisions).
func (r *Repository) score(ctx context.Context, userID string) (float64, error) {
	var s float64
	err := r.db.QueryRow(ctx,
		`SELECT trust_score FROM users WHERE id = $1 AND deleted_at IS NULL`, userID,
	).Scan(&s)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return s, err
}

// apply persists a new score/tier and appends a trust_score_log row in one
// transaction, so the stored score and its audit trail never diverge.
func (r *Repository) apply(ctx context.Context, userID string, newScore float64, newTier, reason, triggeredBy string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) // no-op once committed

	var oldScore float64
	if err := tx.QueryRow(ctx,
		`SELECT trust_score FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, userID,
	).Scan(&oldScore); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	if _, err := tx.Exec(ctx,
		`UPDATE users SET trust_score = $2, trust_tier = $3 WHERE id = $1`, userID, newScore, newTier,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO trust_score_log (user_id, old_score, new_score, reason, triggered_by)
		 VALUES ($1, $2, $3, $4, $5)`, userID, oldScore, newScore, reason, triggeredBy,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
