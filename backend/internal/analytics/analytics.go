// Package analytics gives chapter admins a read-only view of member health:
// drop-off (who's gone quiet), weekly engagement, and activity volume. All
// metrics are computed on the fly from the existing run_logs + run_attendance
// tables — cheap at current scale; a refresh cache is a future optimisation.
//
// "Activity" for a member means the most recent of: a logged run (run_logs) or a
// session check-in (run_attendance), scoped to the chapter.
package analytics

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Dropoff buckets a chapter's active members by how long they've been inactive.
// The buckets are cumulative (a 60-day-inactive member is also counted in 7/14/30).
type Dropoff struct {
	Inactive7d   int `json:"inactive_7d"`
	Inactive14d  int `json:"inactive_14d"`
	Inactive30d  int `json:"inactive_30d"`
	Inactive60d  int `json:"inactive_60d"`
	TotalMembers int `json:"total_members"`
}

// Engagement is the share of active members who logged activity in the last 7 days.
type Engagement struct {
	WeeklyActive int     `json:"weekly_active"`
	TotalMembers int     `json:"total_members"`
	Rate         float64 `json:"engagement_rate"` // 0..100, one decimal
}

// VolumePoint is one week's total distance + run count for the chapter.
type VolumePoint struct {
	WeekStart string  `json:"week_start"` // Monday, "YYYY-MM-DD"
	KM        float64 `json:"km"`
	Runs      int     `json:"runs"`
}

// Repository computes analytics straight from Postgres.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// activeMembers + lastActivity CTEs, shared by the drop-off and engagement
// queries. epoch ('1970-01-01') stands in for "never active", so a member who
// has never logged anything lands in every inactivity bucket.
const lastActivityCTE = `
	WITH members AS (
		SELECT user_id FROM chapter_members
		WHERE chapter_id = $1 AND deleted_at IS NULL AND status = 'active'
	),
	last_act AS (
		SELECT m.user_id, GREATEST(
			COALESCE((SELECT max(rl.ran_on)::timestamptz FROM run_logs rl
			          WHERE rl.user_id = m.user_id AND rl.chapter_id = $1 AND rl.deleted_at IS NULL), 'epoch'),
			COALESCE((SELECT max(ra.checked_in_at) FROM run_attendance ra
			          WHERE ra.user_id = m.user_id AND ra.chapter_id = $1 AND ra.deleted_at IS NULL), 'epoch')
		) AS last_at
		FROM members m
	)`

// Dropoff returns the inactivity buckets for a chapter's active members.
func (r *Repository) Dropoff(ctx context.Context, chapterID uuid.UUID) (Dropoff, error) {
	const q = lastActivityCTE + `
		SELECT
			count(*) FILTER (WHERE last_at < now() - interval '7 days')  AS inactive_7,
			count(*) FILTER (WHERE last_at < now() - interval '14 days') AS inactive_14,
			count(*) FILTER (WHERE last_at < now() - interval '30 days') AS inactive_30,
			count(*) FILTER (WHERE last_at < now() - interval '60 days') AS inactive_60,
			count(*) AS total
		FROM last_act`
	var d Dropoff
	err := r.db.QueryRow(ctx, q, chapterID).Scan(
		&d.Inactive7d, &d.Inactive14d, &d.Inactive30d, &d.Inactive60d, &d.TotalMembers,
	)
	return d, err
}

// Engagement returns the weekly engagement rate for a chapter.
func (r *Repository) Engagement(ctx context.Context, chapterID uuid.UUID) (Engagement, error) {
	const q = `
		WITH members AS (
			SELECT user_id FROM chapter_members
			WHERE chapter_id = $1 AND deleted_at IS NULL AND status = 'active'
		)
		SELECT
			(SELECT count(*) FROM members) AS total,
			(SELECT count(*) FROM members m WHERE
				EXISTS (SELECT 1 FROM run_logs rl WHERE rl.user_id = m.user_id AND rl.chapter_id = $1
				          AND rl.deleted_at IS NULL AND rl.ran_on >= (now() - interval '7 days')::date)
				OR EXISTS (SELECT 1 FROM run_attendance ra WHERE ra.user_id = m.user_id AND ra.chapter_id = $1
				          AND ra.deleted_at IS NULL AND ra.checked_in_at >= now() - interval '7 days')
			) AS weekly_active`
	var e Engagement
	if err := r.db.QueryRow(ctx, q, chapterID).Scan(&e.TotalMembers, &e.WeeklyActive); err != nil {
		return Engagement{}, err
	}
	if e.TotalMembers > 0 {
		e.Rate = float64(int(float64(e.WeeklyActive)/float64(e.TotalMembers)*1000+0.5)) / 10 // round to 0.1
	}
	return e, nil
}

// Volume returns total distance + run count per week for the last 8 weeks.
func (r *Repository) Volume(ctx context.Context, chapterID uuid.UUID) ([]VolumePoint, error) {
	const q = `
		SELECT to_char(date_trunc('week', ran_on), 'YYYY-MM-DD') AS week_start,
		       SUM(distance_km)::float8 AS km, COUNT(*)::int AS runs
		FROM run_logs
		WHERE chapter_id = $1 AND deleted_at IS NULL
		  AND ran_on >= (date_trunc('week', now()) - interval '7 weeks')::date
		GROUP BY 1 ORDER BY 1`
	rows, err := r.db.Query(ctx, q, chapterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]VolumePoint, 0, 8)
	for rows.Next() {
		var p VolumePoint
		if err := rows.Scan(&p.WeekStart, &p.KM, &p.Runs); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
