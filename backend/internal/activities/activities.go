// Package activities owns the activity (a recorded run): its domain model and
// the repository (all SQL touching the activities table). Stats are computed at
// insert time — partly in Go, partly by PostGIS — and stored, because a
// recorded run is immutable, so derived values can be frozen with it.
package activities

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when an activity doesn't exist or isn't owned by the
// requesting user (we don't distinguish the two, to avoid leaking valid ids).
var ErrNotFound = errors.New("activity not found")

// Activity is the stored run. The route geometry itself isn't echoed back here
// (it can be large); a later GeoJSON endpoint will serve it on demand.
type Activity struct {
	ID             uuid.UUID  `json:"id"`        // RunMitra-generated
	UserID         string     `json:"user_id"`   // MarathonMitra user id
	StartedAt      time.Time  `json:"started_at"`
	EndedAt        time.Time  `json:"ended_at"`
	DurationS      int        `json:"duration_s"`
	DistanceM      float64    `json:"distance_m"`
	AvgPaceSPerKM  *float64   `json:"avg_pace_s_per_km"` // pointer: NULL when distance is 0
	ElevationGainM float64    `json:"elevation_gain_m"`
	CreatedAt      time.Time  `json:"created_at"`
}

// NewActivity bundles everything needed to insert one run. The service builds
// this (after computing the Go-side stats) and hands it to the repository.
type NewActivity struct {
	UserID         string
	StartedAt      time.Time
	EndedAt        time.Time
	DurationS      int
	ElevationGainM float64
	RouteEWKT      string // "SRID=4326;LINESTRING(...)" from geo.LineStringEWKT
}

// Repository is the data-access layer for activities.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Create inserts a run and returns the stored row.
//
// Note what PostGIS does for us inside this one statement:
//   - ST_GeogFromText parses our EWKT into a geography value.
//   - ST_Length(route) returns the route's GEODESIC length in meters — the
//     real distance over the earth's surface. We compute it in SQL and return
//     it via RETURNING, so distance and the stored route can never disagree.
//   - avg pace (sec/km) is derived from that distance, guarded against
//     divide-by-zero with NULLIF so a zero-distance run yields NULL pace.
func (r *Repository) Create(ctx context.Context, a NewActivity) (*Activity, error) {
	const q = `
		WITH input AS (
			SELECT ST_GeogFromText($6) AS route
		)
		INSERT INTO activities (
			user_id, started_at, ended_at, duration_s,
			distance_m, avg_pace_s_per_km, elevation_gain_m, route
		)
		SELECT
			$1, $2, $3, $4::int,
			ST_Length(input.route),
			-- pace = seconds per km = duration / (meters) * 1000. Cast duration to
			-- float so $4 has one consistent type and the division is floating
			-- point. NULLIF guards divide-by-zero (zero-distance run -> NULL pace).
			$4::double precision / NULLIF(ST_Length(input.route), 0) * 1000.0,
			$5,
			input.route
		FROM input
		RETURNING id, user_id, started_at, ended_at, duration_s,
		          distance_m, avg_pace_s_per_km, elevation_gain_m, created_at`

	var act Activity
	err := r.db.QueryRow(ctx, q,
		a.UserID, a.StartedAt, a.EndedAt, a.DurationS,
		a.ElevationGainM, a.RouteEWKT,
	).Scan(
		&act.ID, &act.UserID, &act.StartedAt, &act.EndedAt, &act.DurationS,
		&act.DistanceM, &act.AvgPaceSPerKM, &act.ElevationGainM, &act.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &act, nil
}

// ListByUser returns a user's activities, newest first. Pagination (limit far
// from huge) keeps responses small; the history screen will pass these.
func (r *Repository) ListByUser(ctx context.Context, userID string, limit, offset int) ([]Activity, error) {
	const q = `
		SELECT id, user_id, started_at, ended_at, duration_s,
		       distance_m, avg_pace_s_per_km, elevation_gain_m, created_at
		FROM activities
		WHERE user_id = $1
		ORDER BY started_at DESC
		LIMIT $2 OFFSET $3`

	rows, err := r.db.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Start non-nil so an empty result serializes as [] rather than null.
	out := make([]Activity, 0)
	for rows.Next() {
		var act Activity
		if err := rows.Scan(
			&act.ID, &act.UserID, &act.StartedAt, &act.EndedAt, &act.DurationS,
			&act.DistanceM, &act.AvgPaceSPerKM, &act.ElevationGainM, &act.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, act)
	}
	return out, rows.Err()
}

// GetByID fetches one activity. It filters on user_id as well as id so a user
// can never read someone else's run by guessing its UUID — ownership is enforced
// in the query itself, not as an afterthought. Returns ErrNotFound if no row
// matches (whether it doesn't exist or belongs to another user — we don't
// distinguish, so we don't leak which ids are real).
func (r *Repository) GetByID(ctx context.Context, userID string, id uuid.UUID) (*Activity, error) {
	const q = `
		SELECT id, user_id, started_at, ended_at, duration_s,
		       distance_m, avg_pace_s_per_km, elevation_gain_m, created_at
		FROM activities
		WHERE id = $1 AND user_id = $2`

	var act Activity
	err := r.db.QueryRow(ctx, q, id, userID).Scan(
		&act.ID, &act.UserID, &act.StartedAt, &act.EndedAt, &act.DurationS,
		&act.DistanceM, &act.AvgPaceSPerKM, &act.ElevationGainM, &act.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &act, nil
}

// RouteGeoJSON returns the run's route as a GeoJSON geometry string, computed by
// PostGIS (ST_AsGeoJSON). GeoJSON is the lingua franca for web/mobile maps, so
// the client can hand it almost directly to a map library. Ownership-checked.
func (r *Repository) RouteGeoJSON(ctx context.Context, userID string, id uuid.UUID) (string, error) {
	const q = `
		SELECT ST_AsGeoJSON(route)
		FROM activities
		WHERE id = $1 AND user_id = $2`

	var geojson string
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&geojson)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return geojson, nil
}

// Stats holds aggregate numbers for the profile/home dashboard. Pointers are
// used where "no runs yet" should be null rather than a misleading 0 (e.g.
// best pace).
type Stats struct {
	TotalRuns       int      `json:"total_runs"`
	TotalDistanceM  float64  `json:"total_distance_m"`
	TotalDurationS  int      `json:"total_duration_s"`
	LongestRunM     float64  `json:"longest_run_m"`
	BestPaceSPerKM  *float64 `json:"best_pace_s_per_km"`
	CurrentStreakDays int    `json:"current_streak_days"`
}

// Stats computes all-time totals for a user in a single aggregate query, then
// derives the day-streak from the distinct days the user ran.
func (r *Repository) Stats(ctx context.Context, userID string) (*Stats, error) {
	const q = `
		SELECT
			COUNT(*),
			COALESCE(SUM(distance_m), 0),
			COALESCE(SUM(duration_s), 0),
			COALESCE(MAX(distance_m), 0),
			MIN(avg_pace_s_per_km) FILTER (WHERE avg_pace_s_per_km IS NOT NULL)
		FROM activities WHERE user_id = $1`

	var s Stats
	if err := r.db.QueryRow(ctx, q, userID).Scan(
		&s.TotalRuns, &s.TotalDistanceM, &s.TotalDurationS, &s.LongestRunM, &s.BestPaceSPerKM,
	); err != nil {
		return nil, err
	}

	streak, err := r.currentStreakDays(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.CurrentStreakDays = streak
	return &s, nil
}

// currentStreakDays returns how many consecutive days up to today the user has
// run. We fetch the distinct run-days (newest first) and walk them: the streak
// is unbroken while each day is exactly one day before the previous. It counts
// only if the most recent run was today or yesterday (today not yet run is still
// a live streak).
func (r *Repository) currentStreakDays(ctx context.Context, userID string) (int, error) {
	const q = `
		SELECT DISTINCT (started_at AT TIME ZONE 'UTC')::date AS d
		FROM activities WHERE user_id = $1
		ORDER BY d DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var days []time.Time
	for rows.Next() {
		var d time.Time
		if err := rows.Scan(&d); err != nil {
			return 0, err
		}
		days = append(days, d)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(days) == 0 {
		return 0, nil
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	// Most recent run must be today or yesterday for the streak to be "current".
	gap := int(today.Sub(days[0]) / (24 * time.Hour))
	if gap > 1 {
		return 0, nil
	}

	streak := 1
	for i := 1; i < len(days); i++ {
		if int(days[i-1].Sub(days[i])/(24*time.Hour)) == 1 {
			streak++
		} else {
			break
		}
	}
	return streak, nil
}
