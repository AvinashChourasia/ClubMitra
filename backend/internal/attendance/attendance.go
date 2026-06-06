// Package attendance covers a chapter's group runs: an admin schedules a run,
// and members check in afterwards. It records who showed up — separate from the
// GPS `activities` of Phase 3, which record how someone ran.
package attendance

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Run is a scheduled group run.
type Run struct {
	ID             uuid.UUID  `json:"id"`
	ChapterID      uuid.UUID  `json:"chapter_id"`
	CreatedBy      string     `json:"created_by"`
	Title          string     `json:"title"`
	ScheduledAt    time.Time  `json:"scheduled_at"`
	Location       *string    `json:"location,omitempty"`
	LocationLat    *float64   `json:"location_lat,omitempty"`
	LocationLng    *float64   `json:"location_lng,omitempty"`
	DistanceTarget *float64   `json:"distance_target,omitempty"`
	Notes          *string    `json:"notes,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	// AttendeeCount is populated on list/get so clients can show "12 checked in"
	// without a second call.
	AttendeeCount int `json:"attendee_count"`
}

// NewRun carries the fields needed to schedule a run.
type NewRun struct {
	ChapterID      uuid.UUID
	CreatedBy      string
	Title          string
	ScheduledAt    time.Time
	Location       *string
	LocationLat    *float64
	LocationLng    *float64
	DistanceTarget *float64
	Notes          *string
}

// Attendee is one member's check-in to a run, joined with their name.
type Attendee struct {
	UserID      string    `json:"user_id"`
	Name        string    `json:"name"`
	CheckedInAt time.Time `json:"checked_in_at"`
	SelfCheckIn bool      `json:"self_check_in"`
}

// MemberAttendance is one row of a member's attendance history.
type MemberAttendance struct {
	RunID       uuid.UUID `json:"run_id"`
	Title       string    `json:"title"`
	ScheduledAt time.Time `json:"scheduled_at"`
	CheckedInAt time.Time `json:"checked_in_at"`
}

// ErrNotFound is returned when a run lookup matches nothing.
var ErrNotFound = errors.New("run not found")

// Repository is the data-access layer for attendance.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// ScheduleRun inserts a new run.
func (r *Repository) ScheduleRun(ctx context.Context, n NewRun) (*Run, error) {
	const q = `
		INSERT INTO runs (chapter_id, created_by, title, scheduled_at,
		                  location, location_lat, location_lng, distance_target, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, chapter_id, created_by, title, scheduled_at,
		          location, location_lat, location_lng, distance_target, notes, created_at`
	var run Run
	err := r.db.QueryRow(ctx, q,
		n.ChapterID, n.CreatedBy, n.Title, n.ScheduledAt,
		n.Location, n.LocationLat, n.LocationLng, n.DistanceTarget, n.Notes,
	).Scan(
		&run.ID, &run.ChapterID, &run.CreatedBy, &run.Title, &run.ScheduledAt,
		&run.Location, &run.LocationLat, &run.LocationLng, &run.DistanceTarget, &run.Notes, &run.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &run, nil
}

// ListRuns returns a chapter's runs, soonest-scheduled first, each with a live
// attendee count.
func (r *Repository) ListRuns(ctx context.Context, chapterID uuid.UUID) ([]Run, error) {
	const q = `
		SELECT r.id, r.chapter_id, r.created_by, r.title, r.scheduled_at,
		       r.location, r.location_lat, r.location_lng, r.distance_target, r.notes, r.created_at,
		       COUNT(a.id) FILTER (WHERE a.deleted_at IS NULL) AS attendee_count
		FROM runs r
		LEFT JOIN run_attendance a ON a.run_id = r.id
		WHERE r.chapter_id = $1 AND r.deleted_at IS NULL
		GROUP BY r.id
		ORDER BY r.scheduled_at DESC`
	rows, err := r.db.Query(ctx, q, chapterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Run, 0) // never nil, so the JSON is [] not null
	for rows.Next() {
		run, err := scanRunWithCount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *run)
	}
	return out, rows.Err()
}

// GetRun fetches one run (with attendee count). Used by check-in to learn the
// run's chapter, and by the run-detail view.
func (r *Repository) GetRun(ctx context.Context, runID uuid.UUID) (*Run, error) {
	const q = `
		SELECT r.id, r.chapter_id, r.created_by, r.title, r.scheduled_at,
		       r.location, r.location_lat, r.location_lng, r.distance_target, r.notes, r.created_at,
		       COUNT(a.id) FILTER (WHERE a.deleted_at IS NULL) AS attendee_count
		FROM runs r
		LEFT JOIN run_attendance a ON a.run_id = r.id
		WHERE r.id = $1 AND r.deleted_at IS NULL
		GROUP BY r.id`
	run, err := scanRunWithCount(r.db.QueryRow(ctx, q, runID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return run, err
}

// CheckIn records a member's attendance for a run. markedBy is nil for a
// self check-in. ON CONFLICT keeps it idempotent (and revives a removed row).
func (r *Repository) CheckIn(ctx context.Context, runID, chapterID uuid.UUID, userID string, markedBy *string) error {
	const q = `
		INSERT INTO run_attendance (run_id, user_id, chapter_id, marked_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (run_id, user_id) DO UPDATE
			SET deleted_at = NULL, marked_by = EXCLUDED.marked_by`
	_, err := r.db.Exec(ctx, q, runID, userID, chapterID, markedBy)
	return err
}

// ListAttendees returns who checked in to a run.
func (r *Repository) ListAttendees(ctx context.Context, runID uuid.UUID) ([]Attendee, error) {
	const q = `
		SELECT a.user_id, u.name, a.checked_in_at, (a.marked_by IS NULL) AS self_check_in
		FROM run_attendance a
		JOIN users u ON u.id = a.user_id
		WHERE a.run_id = $1 AND a.deleted_at IS NULL
		ORDER BY a.checked_in_at`
	rows, err := r.db.Query(ctx, q, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Attendee, 0)
	for rows.Next() {
		var a Attendee
		if err := rows.Scan(&a.UserID, &a.Name, &a.CheckedInAt, &a.SelfCheckIn); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// MemberHistory returns a member's attendance across all chapters, newest first.
func (r *Repository) MemberHistory(ctx context.Context, userID string) ([]MemberAttendance, error) {
	const q = `
		SELECT a.run_id, r.title, r.scheduled_at, a.checked_in_at
		FROM run_attendance a
		JOIN runs r ON r.id = a.run_id
		WHERE a.user_id = $1 AND a.deleted_at IS NULL AND r.deleted_at IS NULL
		ORDER BY a.checked_in_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]MemberAttendance, 0)
	for rows.Next() {
		var m MemberAttendance
		if err := rows.Scan(&m.RunID, &m.Title, &m.ScheduledAt, &m.CheckedInAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// scanRow is satisfied by both pgx.Row and pgx.Rows.
type scanRow interface {
	Scan(dest ...any) error
}

func scanRunWithCount(s scanRow) (*Run, error) {
	var run Run
	err := s.Scan(
		&run.ID, &run.ChapterID, &run.CreatedBy, &run.Title, &run.ScheduledAt,
		&run.Location, &run.LocationLat, &run.LocationLng, &run.DistanceTarget, &run.Notes, &run.CreatedAt,
		&run.AttendeeCount,
	)
	if err != nil {
		return nil, err
	}
	return &run, nil
}
