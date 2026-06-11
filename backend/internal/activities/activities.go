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
	ID             uuid.UUID  `json:"id"`        // ClubMitra-generated
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
	RouteEWKT      string    // "SRID=4326;LINESTRING(...)" from geo.LineStringEWKT
	PointOffsets   []float64 // seconds-from-start per route vertex, aligned 1:1
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
			distance_m, avg_pace_s_per_km, elevation_gain_m, route, point_offsets
		)
		SELECT
			$1, $2, $3, $4::int,
			ST_Length(input.route),
			-- pace = seconds per km = duration / (meters) * 1000. Cast duration to
			-- float so $4 has one consistent type and the division is floating
			-- point. NULLIF guards divide-by-zero (zero-distance run -> NULL pace).
			$4::double precision / NULLIF(ST_Length(input.route), 0) * 1000.0,
			$5,
			input.route,
			$7
		FROM input
		RETURNING id, user_id, started_at, ended_at, duration_s,
		          distance_m, avg_pace_s_per_km, elevation_gain_m, created_at`

	var act Activity
	err := r.db.QueryRow(ctx, q,
		a.UserID, a.StartedAt, a.EndedAt, a.DurationS,
		a.ElevationGainM, a.RouteEWKT, a.PointOffsets,
	).Scan(
		&act.ID, &act.UserID, &act.StartedAt, &act.EndedAt, &act.DurationS,
		&act.DistanceM, &act.AvgPaceSPerKM, &act.ElevationGainM, &act.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &act, nil
}

// HasRunNear reports whether the user already has a run starting within tol of
// t — the duplicate gate for GPX imports (re-importing the same file, or
// importing a Strava export of a run also tracked live, lands on the same
// start instant give or take clock drift).
func (r *Repository) HasRunNear(ctx context.Context, userID string, t time.Time, tol time.Duration) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM activities
			WHERE user_id = $1 AND started_at BETWEEN $2 AND $3
		)`
	var exists bool
	err := r.db.QueryRow(ctx, q, userID, t.Add(-tol), t.Add(tol)).Scan(&exists)
	return exists, err
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

// RouteWithMeta returns the run's route as a GeoJSON geometry string (computed by
// PostGIS via ST_AsGeoJSON) plus the per-vertex seconds-from-start offsets,
// aligned 1:1 with the geometry's coordinates so the client can colour the route
// by pace. offsets is nil for runs recorded before offsets were stored.
// Ownership-checked.
func (r *Repository) RouteWithMeta(ctx context.Context, userID string, id uuid.UUID) (string, []float64, error) {
	const q = `
		SELECT ST_AsGeoJSON(route), point_offsets
		FROM activities
		WHERE id = $1 AND user_id = $2`

	var geojson string
	var offsets []float64
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&geojson, &offsets)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, ErrNotFound
	}
	if err != nil {
		return "", nil, err
	}
	return geojson, offsets, nil
}

// FeedItem is one club-feed entry: a member's recorded run with their display
// fields — enough for "Asha ran 5.2 km · 6:01/km · 2h ago".
type FeedItem struct {
	ActivityID   uuid.UUID `json:"activity_id"`
	UserID       string    `json:"user_id"`
	Name         string    `json:"name"`
	ProfilePhoto *string   `json:"profile_photo,omitempty"`
	StartedAt    time.Time `json:"started_at"`
	DistanceM    float64   `json:"distance_m"`
	DurationS    int       `json:"duration_s"`
	AvgPace      *float64  `json:"avg_pace_s_per_km"`
}

// IsChapterMember mirrors the membership check used by chat: a live membership
// row in the chapter. (The feed is member-only — runs aren't public.)
func (r *Repository) IsChapterMember(ctx context.Context, chapterID uuid.UUID, userID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM chapter_members
			WHERE chapter_id = $1 AND user_id = $2 AND deleted_at IS NULL)`,
		chapterID, userID).Scan(&ok)
	return ok, err
}

// ChapterFeed lists the club's recent member runs, newest first.
func (r *Repository) ChapterFeed(ctx context.Context, chapterID uuid.UUID, limit int) ([]FeedItem, error) {
	const q = `
		SELECT a.id, a.user_id, u.name, u.profile_photo,
		       a.started_at, a.distance_m, a.duration_s, a.avg_pace_s_per_km
		FROM activities a
		JOIN chapter_members cm ON cm.user_id = a.user_id
		     AND cm.chapter_id = $1 AND cm.deleted_at IS NULL
		JOIN users u ON u.id = a.user_id
		ORDER BY a.started_at DESC
		LIMIT $2`
	rows, err := r.db.Query(ctx, q, chapterID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]FeedItem, 0)
	for rows.Next() {
		var f FeedItem
		if err := rows.Scan(&f.ActivityID, &f.UserID, &f.Name, &f.ProfilePhoto,
			&f.StartedAt, &f.DistanceM, &f.DurationS, &f.AvgPace); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CityBoardEntry is one row of the city leaderboard — a runner ranked by total
// GPS-verified distance in the window.
type CityBoardEntry struct {
	Rank         int     `json:"rank"`
	UserID       string  `json:"user_id"`
	DisplayName  string  `json:"display_name"`
	ProfilePhoto *string `json:"profile_photo"`
	DistanceM    float64 `json:"distance_m"`
	Runs         int     `json:"runs"`
}

// CityBoardView wraps the ranked rows with the city + period they're for, so the
// client can label the screen without guessing.
type CityBoardView struct {
	City    string           `json:"city"`
	Period  string           `json:"period"`
	Entries []CityBoardEntry `json:"entries"`
}

// UserCity returns a user's city (empty string if unset). Used to default the
// city leaderboard to the requester's own city.
func (r *Repository) UserCity(ctx context.Context, userID string) (string, error) {
	var city *string
	if err := r.db.QueryRow(ctx, `SELECT city FROM users WHERE id = $1`, userID).Scan(&city); err != nil {
		return "", err
	}
	if city == nil {
		return "", nil
	}
	return *city, nil
}

// CityBoardEntries ranks every runner in a city by total GPS distance since
// `from`. Only the activities table feeds this (so it's truly verified), joined
// to users for the city + display fields. Case-insensitive city match.
func (r *Repository) CityBoardEntries(ctx context.Context, city string, from time.Time) ([]CityBoardEntry, error) {
	const q = `
		SELECT a.user_id, u.name, u.profile_photo,
		       SUM(a.distance_m)::float8 AS dist, COUNT(*)::int AS runs
		FROM activities a
		JOIN users u ON u.id = a.user_id
		WHERE u.city IS NOT NULL AND lower(u.city) = lower($1)
		  AND a.started_at >= $2
		GROUP BY a.user_id, u.name, u.profile_photo
		ORDER BY dist DESC, runs DESC
		LIMIT 100`
	rows, err := r.db.Query(ctx, q, city, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]CityBoardEntry, 0)
	rank := 0
	for rows.Next() {
		rank++
		e := CityBoardEntry{Rank: rank}
		if err := rows.Scan(&e.UserID, &e.DisplayName, &e.ProfilePhoto, &e.DistanceM, &e.Runs); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
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
	FreezesLeft     int      `json:"streak_freezes_left"` // this month's unused allowance
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
	left, err := r.freezesLeft(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.FreezesLeft = left
	return &s, nil
}

// freezesPerMonth is each runner's streak-freeze allowance per calendar month.
const freezesPerMonth = 2

// currentStreakDays returns how many consecutive days up to today the user has
// run — with streak freezes: a missed day is bridged automatically (and the
// freeze consumed, max 2 per calendar month) as long as a real run day sits on
// the far side of the gap. Today not yet run is still a live streak and never
// costs a freeze. Frozen days bridge the walk but don't increment the count.
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

	// Existing freezes: they bridge for free and count toward their month's use.
	frozen := map[string]bool{}
	monthUsed := map[string]int{}
	fr, err := r.db.Query(ctx, `SELECT frozen_on FROM streak_freezes WHERE user_id = $1`, userID)
	if err != nil {
		return 0, err
	}
	for fr.Next() {
		var d time.Time
		if err := fr.Scan(&d); err != nil {
			fr.Close()
			return 0, err
		}
		frozen[d.Format("2006-01-02")] = true
		monthUsed[d.Format("2006-01")]++
	}
	fr.Close()
	if err := fr.Err(); err != nil {
		return 0, err
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	cursor := today
	if !days[0].Equal(today) {
		cursor = today.AddDate(0, 0, -1) // today is optional — there's still time to run
	}

	streak := 0
	var newFreezes []time.Time
	for _, runDay := range days {
		if runDay.After(cursor) {
			continue // already covered (e.g. today's run when cursor started at today)
		}
		// Bridge the missing days between the cursor and this run day. Every one
		// must be frozen (existing or freshly consumable), or the streak ends here.
		ok := true
		for d := cursor; d.After(runDay); d = d.AddDate(0, 0, -1) {
			key := d.Format("2006-01-02")
			if frozen[key] {
				continue
			}
			month := d.Format("2006-01")
			if monthUsed[month] >= freezesPerMonth {
				ok = false
				break
			}
			monthUsed[month]++
			frozen[key] = true
			newFreezes = append(newFreezes, d)
		}
		if !ok {
			break
		}
		streak++
		cursor = runDay.AddDate(0, 0, -1)
	}

	// Persist the freezes this walk consumed (idempotent via the PK).
	for _, d := range newFreezes {
		_, _ = r.db.Exec(ctx,
			`INSERT INTO streak_freezes (user_id, frozen_on) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			userID, d)
	}
	return streak, nil
}

// freezesLeft returns the unused streak-freeze allowance for the current month.
func (r *Repository) freezesLeft(ctx context.Context, userID string) (int, error) {
	var used int
	err := r.db.QueryRow(ctx, `
		SELECT count(*) FROM streak_freezes
		WHERE user_id = $1 AND date_trunc('month', frozen_on) = date_trunc('month', now())`,
		userID).Scan(&used)
	if err != nil {
		return 0, err
	}
	left := freezesPerMonth - used
	if left < 0 {
		left = 0
	}
	return left, nil
}
