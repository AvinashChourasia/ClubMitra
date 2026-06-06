package attendance

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// Service holds attendance business logic over the repository.
type Service struct {
	repo *Repository
}

// NewService wires the service to its repository.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// ScheduleRun validates and creates a run. Authorization (must be a chapter
// admin) is enforced by the handler before this is called.
func (s *Service) ScheduleRun(ctx context.Context, n NewRun) (*Run, error) {
	n.Title = strings.TrimSpace(n.Title)
	if n.Title == "" {
		return nil, ValidationError{Msg: "title is required"}
	}
	if n.ScheduledAt.IsZero() {
		return nil, ValidationError{Msg: "scheduled_at is required"}
	}
	if n.DistanceTarget != nil && *n.DistanceTarget < 0 {
		return nil, ValidationError{Msg: "distance_target cannot be negative"}
	}
	return s.repo.ScheduleRun(ctx, n)
}

// maxBulkRuns caps how many runs one recurring schedule can create.
const maxBulkRuns = 120

// BulkSchedule creates one run per supplied occurrence (the recurring path).
func (s *Service) BulkSchedule(ctx context.Context, base NewRun, times []time.Time) ([]Run, error) {
	base.Title = strings.TrimSpace(base.Title)
	if base.Title == "" {
		return nil, ValidationError{Msg: "title is required"}
	}
	if len(times) == 0 {
		return nil, ValidationError{Msg: "at least one date is required"}
	}
	if len(times) > maxBulkRuns {
		return nil, ValidationError{Msg: "that recurrence creates too many runs; shorten the date range"}
	}
	if base.DistanceTarget != nil && *base.DistanceTarget < 0 {
		return nil, ValidationError{Msg: "distance_target cannot be negative"}
	}
	return s.repo.BulkSchedule(ctx, base, times)
}

// UpdateRun edits a run (organiser action; authorization enforced by handler).
func (s *Service) UpdateRun(ctx context.Context, runID uuid.UUID, u RunUpdate) (*Run, error) {
	u.Title = strings.TrimSpace(u.Title)
	if u.Title == "" {
		return nil, ValidationError{Msg: "title is required"}
	}
	if u.ScheduledAt.IsZero() {
		return nil, ValidationError{Msg: "scheduled_at is required"}
	}
	return s.repo.UpdateRun(ctx, runID, u)
}

// MyRuns returns the caller's personal schedule across all their chapters.
func (s *Service) MyRuns(ctx context.Context, userID string) ([]MyRun, error) {
	return s.repo.ListUserRuns(ctx, userID)
}

// ListRuns returns a chapter's runs.
func (s *Service) ListRuns(ctx context.Context, chapterID uuid.UUID) ([]Run, error) {
	return s.repo.ListRuns(ctx, chapterID)
}

// GetRun returns one run.
func (s *Service) GetRun(ctx context.Context, runID uuid.UUID) (*Run, error) {
	return s.repo.GetRun(ctx, runID)
}

// CheckIn records attendance for a run. It first loads the run (to resolve the
// chapter and to 404 on an unknown/deleted run), then writes the attendance row.
// markedBy is nil for a self check-in, or the admin's id when marking someone.
func (s *Service) CheckIn(ctx context.Context, runID uuid.UUID, userID string, markedBy *string) (*Run, error) {
	run, err := s.repo.GetRun(ctx, runID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CheckIn(ctx, run.ID, run.ChapterID, userID, markedBy); err != nil {
		return nil, err
	}
	// Re-fetch so the returned attendee_count reflects this check-in.
	return s.repo.GetRun(ctx, run.ID)
}

// CheckOut removes the caller's attendance from a run (with an optional reason),
// returning the refreshed run. Loads the run first to 404 on an unknown run.
func (s *Service) CheckOut(ctx context.Context, runID uuid.UUID, userID string, reason *string) (*Run, error) {
	run, err := s.repo.GetRun(ctx, runID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CheckOut(ctx, run.ID, userID, reason); err != nil {
		return nil, err
	}
	return s.repo.GetRun(ctx, run.ID)
}

// ListAttendees returns who checked in to a run.
func (s *Service) ListAttendees(ctx context.Context, runID uuid.UUID) ([]Attendee, error) {
	return s.repo.ListAttendees(ctx, runID)
}

// MemberHistory returns a member's attendance history.
func (s *Service) MemberHistory(ctx context.Context, userID string) ([]MemberAttendance, error) {
	return s.repo.MemberHistory(ctx, userID)
}

// ChapterOfRun returns the chapter a run belongs to, for the handler's
// permission check when an admin marks another member present.
func (s *Service) ChapterOfRun(ctx context.Context, runID uuid.UUID) (uuid.UUID, error) {
	run, err := s.repo.GetRun(ctx, runID)
	if err != nil {
		return uuid.Nil, err
	}
	return run.ChapterID, nil
}

// parseTime is a small helper the handler reuses; kept here so the time format
// the API accepts lives next to the domain. RFC3339 (e.g. 2026-06-10T06:30:00Z).
func parseTime(s string) (time.Time, error) {
	return time.Parse(time.RFC3339, strings.TrimSpace(s))
}
