// Package challenges owns virtual run challenges: the domain model and the
// repository (all SQL for the challenges + challenge_members tables). The
// service layer combines this durable data with the Redis leaderboard.
package challenges

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a challenge doesn't exist.
var ErrNotFound = errors.New("challenge not found")

// Challenge is a virtual goal over a time window.
type Challenge struct {
	ID              uuid.UUID `json:"id"`         // RunMitra-generated
	CreatorID       string    `json:"creator_id"` // MarathonMitra user id
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	TargetDistanceM float64   `json:"target_distance_m"`
	StartsAt        time.Time `json:"starts_at"`
	EndsAt          time.Time `json:"ends_at"`
	CreatedAt       time.Time `json:"created_at"`

	// Populated only on list/get for the current user (not stored columns):
	// whether they've joined, and their progress so far.
	Joined          bool    `json:"joined"`
	ProgressDistanceM float64 `json:"progress_distance_m"`
}

// NewChallenge is the input for creating a challenge.
type NewChallenge struct {
	CreatorID       string
	Name            string
	Description     string
	TargetDistanceM float64
	StartsAt        time.Time
	EndsAt          time.Time
}

// Repository is the data-access layer for challenges.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Create inserts a challenge and returns the stored row.
func (r *Repository) Create(ctx context.Context, c NewChallenge) (*Challenge, error) {
	const q = `
		INSERT INTO challenges (creator_id, name, description, target_distance_m, starts_at, ends_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, creator_id, name, description, target_distance_m, starts_at, ends_at, created_at`
	var ch Challenge
	err := r.db.QueryRow(ctx, q,
		c.CreatorID, c.Name, c.Description, c.TargetDistanceM, c.StartsAt, c.EndsAt,
	).Scan(
		&ch.ID, &ch.CreatorID, &ch.Name, &ch.Description, &ch.TargetDistanceM,
		&ch.StartsAt, &ch.EndsAt, &ch.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &ch, nil
}

// Get returns one challenge, annotated with the given user's membership state.
// A LEFT JOIN to challenge_members means we get the challenge whether or not the
// user has joined; the membership columns come back NULL if they haven't.
func (r *Repository) Get(ctx context.Context, userID string, id uuid.UUID) (*Challenge, error) {
	const q = `
		SELECT c.id, c.creator_id, c.name, c.description, c.target_distance_m,
		       c.starts_at, c.ends_at, c.created_at,
		       m.user_id IS NOT NULL AS joined,
		       COALESCE(m.progress_distance_m, 0)
		FROM challenges c
		LEFT JOIN challenge_members m ON m.challenge_id = c.id AND m.user_id = $2
		WHERE c.id = $1`
	var ch Challenge
	err := r.db.QueryRow(ctx, q, id, userID).Scan(
		&ch.ID, &ch.CreatorID, &ch.Name, &ch.Description, &ch.TargetDistanceM,
		&ch.StartsAt, &ch.EndsAt, &ch.CreatedAt, &ch.Joined, &ch.ProgressDistanceM,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ch, nil
}

// List returns challenges annotated with the user's membership. When joinedOnly
// is true it returns just the user's challenges ("My challenges"); otherwise all
// challenges (browse).
func (r *Repository) List(ctx context.Context, userID string, joinedOnly bool) ([]Challenge, error) {
	q := `
		SELECT c.id, c.creator_id, c.name, c.description, c.target_distance_m,
		       c.starts_at, c.ends_at, c.created_at,
		       m.user_id IS NOT NULL AS joined,
		       COALESCE(m.progress_distance_m, 0)
		FROM challenges c
		LEFT JOIN challenge_members m ON m.challenge_id = c.id AND m.user_id = $1`
	if joinedOnly {
		q += " WHERE m.user_id IS NOT NULL"
	}
	q += " ORDER BY c.ends_at ASC"

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Challenge, 0)
	for rows.Next() {
		var ch Challenge
		if err := rows.Scan(
			&ch.ID, &ch.CreatorID, &ch.Name, &ch.Description, &ch.TargetDistanceM,
			&ch.StartsAt, &ch.EndsAt, &ch.CreatedAt, &ch.Joined, &ch.ProgressDistanceM,
		); err != nil {
			return nil, err
		}
		out = append(out, ch)
	}
	return out, rows.Err()
}

// Join adds a membership row. ON CONFLICT DO NOTHING makes joining idempotent —
// joining twice is harmless. Returns true if a new membership was created.
func (r *Repository) Join(ctx context.Context, challengeID uuid.UUID, userID string) (bool, error) {
	const q = `
		INSERT INTO challenge_members (challenge_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT (challenge_id, user_id) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, challengeID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// AddProgress atomically increases a member's progress and returns the new
// total. Used when a run is recorded. No-op (0 rows) if the user isn't a member.
func (r *Repository) AddProgress(ctx context.Context, challengeID uuid.UUID, userID string, deltaM float64) (float64, bool, error) {
	const q = `
		UPDATE challenge_members
		SET progress_distance_m = progress_distance_m + $3
		WHERE challenge_id = $1 AND user_id = $2
		RETURNING progress_distance_m`
	var total float64
	err := r.db.QueryRow(ctx, q, challengeID, userID, deltaM).Scan(&total)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return total, true, nil
}

// ActiveMembershipsForUser returns the challenges a user is in that are active
// at instant t. Used when a run is recorded to know which boards to update.
func (r *Repository) ActiveMembershipsForUser(ctx context.Context, userID string, t time.Time) ([]uuid.UUID, error) {
	const q = `
		SELECT c.id
		FROM challenge_members m
		JOIN challenges c ON c.id = m.challenge_id
		WHERE m.user_id = $1 AND c.starts_at <= $2 AND c.ends_at > $2`
	rows, err := r.db.Query(ctx, q, userID, t)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// Scores returns every member's total progress for a challenge, for rebuilding
// the Redis leaderboard from the durable source of truth.
func (r *Repository) Scores(ctx context.Context, challengeID uuid.UUID) (map[string]float64, error) {
	const q = `SELECT user_id, progress_distance_m FROM challenge_members WHERE challenge_id = $1`
	rows, err := r.db.Query(ctx, q, challengeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]float64)
	for rows.Next() {
		var uid string
		var total float64
		if err := rows.Scan(&uid, &total); err != nil {
			return nil, err
		}
		out[uid] = total
	}
	return out, rows.Err()
}
