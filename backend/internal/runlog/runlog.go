// Package runlog records manually-logged runs and computes the chapter rolling
// leaderboards (daily/weekly/monthly/all-time) from them.
//
// Leaderboards are aggregated straight from Postgres over a date range — always
// correct, nothing to keep in sync. (A Redis sorted-set cache is the documented
// scale optimisation for later; run_logs stays the source of truth.)
package runlog

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RunLog is one logged run.
type RunLog struct {
	ID         uuid.UUID `json:"id"`
	UserID     string    `json:"user_id"`
	ChapterID  uuid.UUID `json:"chapter_id"`
	DistanceKM float64   `json:"distance_km"`
	RanOn      string    `json:"ran_on"` // YYYY-MM-DD
	Note       *string   `json:"note,omitempty"`
	ProofURL   *string   `json:"proof_url,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// NewLog is the input to log a run.
type NewLog struct {
	ChapterID  uuid.UUID
	DistanceKM float64
	RanOn      string // YYYY-MM-DD
	Note       *string
	ProofURL   *string
}

// BoardEntry is one row of a rolling leaderboard.
type BoardEntry struct {
	Rank        int     `json:"rank"`
	UserID      string  `json:"user_id"`
	DisplayName string  `json:"display_name"`
	KM          float64 `json:"km"`
	Runs        int     `json:"runs"`
}

// Repository is the run_logs data access.
type Repository struct{ db *pgxpool.Pool }

// NewRepository wires the repo to the pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// IsActiveMember reports whether the user is an active member of the chapter.
func (r *Repository) IsActiveMember(ctx context.Context, chapterID uuid.UUID, userID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM chapter_members
			WHERE chapter_id = $1 AND user_id = $2 AND status = 'active' AND deleted_at IS NULL)`,
		chapterID, userID).Scan(&ok)
	return ok, err
}

// Create inserts a logged run.
func (r *Repository) Create(ctx context.Context, userID string, n NewLog) (*RunLog, error) {
	const q = `
		INSERT INTO run_logs (user_id, chapter_id, distance_km, ran_on, note, proof_url)
		VALUES ($1, $2, $3, $4::date, $5, $6)
		RETURNING id, user_id, chapter_id, distance_km, ran_on, note, proof_url, created_at`
	var l RunLog
	var ranOn time.Time
	err := r.db.QueryRow(ctx, q, userID, n.ChapterID, n.DistanceKM, n.RanOn, n.Note, n.ProofURL).
		Scan(&l.ID, &l.UserID, &l.ChapterID, &l.DistanceKM, &ranOn, &l.Note, &l.ProofURL, &l.CreatedAt)
	if err != nil {
		return nil, err
	}
	l.RanOn = ranOn.Format("2006-01-02")
	return &l, nil
}

// MyLogs returns a user's recent logs (newest first).
func (r *Repository) MyLogs(ctx context.Context, userID string, limit int) ([]RunLog, error) {
	const q = `
		SELECT id, user_id, chapter_id, distance_km, ran_on, note, proof_url, created_at
		FROM run_logs
		WHERE user_id = $1 AND deleted_at IS NULL
		ORDER BY ran_on DESC, created_at DESC
		LIMIT $2`
	rows, err := r.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RunLog, 0)
	for rows.Next() {
		var l RunLog
		var ranOn time.Time
		if err := rows.Scan(&l.ID, &l.UserID, &l.ChapterID, &l.DistanceKM, &ranOn, &l.Note, &l.ProofURL, &l.CreatedAt); err != nil {
			return nil, err
		}
		l.RanOn = ranOn.Format("2006-01-02")
		out = append(out, l)
	}
	return out, rows.Err()
}

// Board aggregates the leaderboard for a chapter. from/to are inclusive
// YYYY-MM-DD bounds; both nil means all-time.
func (r *Repository) Board(ctx context.Context, chapterID uuid.UUID, from, to *string) ([]BoardEntry, error) {
	// Members who are on_leave / injured / alumni are paused from the board: join
	// their (current) membership and exclude those states.
	const q = `
		SELECT rl.user_id, u.name, SUM(rl.distance_km)::float8 AS km, COUNT(*)::int AS runs
		FROM run_logs rl
		JOIN users u ON u.id = rl.user_id
		JOIN chapter_members cm ON cm.chapter_id = rl.chapter_id AND cm.user_id = rl.user_id
		     AND cm.deleted_at IS NULL AND cm.status NOT IN ('on_leave', 'injured', 'alumni')
		WHERE rl.chapter_id = $1 AND rl.deleted_at IS NULL
		  AND ($2::date IS NULL OR rl.ran_on >= $2::date)
		  AND ($3::date IS NULL OR rl.ran_on <= $3::date)
		GROUP BY rl.user_id, u.name
		ORDER BY km DESC, runs DESC
		LIMIT 50`
	rows, err := r.db.Query(ctx, q, chapterID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]BoardEntry, 0)
	rank := 0
	for rows.Next() {
		rank++
		e := BoardEntry{Rank: rank}
		if err := rows.Scan(&e.UserID, &e.DisplayName, &e.KM, &e.Runs); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
