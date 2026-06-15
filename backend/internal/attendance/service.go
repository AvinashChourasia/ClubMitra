package attendance

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// notifier pushes a domain event to a chapter's members. Implemented by
// notifications.Notifier; kept as a local interface so attendance doesn't depend
// on the concrete package (and stays nil-safe in tests).
type notifier interface {
	NotifyChapterMembers(ctx context.Context, chapterID uuid.UUID, exclude, title, body string, data map[string]string)
}

// Service holds attendance business logic over the repository.
type Service struct {
	repo       *Repository
	notify     notifier
	checkinKey []byte // HMAC key for rotating check-in codes
}

// NewService wires the service to its repository, (optional) notifier, and the
// secret that signs rotating check-in codes (derived from the JWT secret in
// main, so there's no extra config to set).
func NewService(repo *Repository, notify notifier, checkinSecret string) *Service {
	key := sha256.Sum256([]byte("clubmitra-checkin-v1:" + checkinSecret))
	return &Service{repo: repo, notify: notify, checkinKey: key[:]}
}

// checkinWindowSecs is how long one rotating code is valid. Short enough that a
// screenshot forwarded to an absent friend expires before they can use it.
const checkinWindowSecs = 30

// checkinCode derives the 6-digit code for a run in a given 30-second window —
// TOTP-style: an HMAC of (runID, window) with dynamic truncation. Deterministic,
// so the server can both generate (for the admin's QR) and validate (on scan)
// without storing per-window state.
func (s *Service) checkinCode(runID uuid.UUID, window int64) string {
	mac := hmac.New(sha256.New, s.checkinKey)
	fmt.Fprintf(mac, "%s:%d", runID.String(), window)
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	bin := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", bin%1_000_000)
}

// CurrentCheckinCode returns the run's current code + seconds until it rotates.
// Admin-only (the handler gates it): only the organiser showing the QR sees it.
func (s *Service) CurrentCheckinCode(runID uuid.UUID, now time.Time) (code string, expiresInS int) {
	window := now.Unix() / checkinWindowSecs
	return s.checkinCode(runID, window), int(checkinWindowSecs - now.Unix()%checkinWindowSecs)
}

// validCheckinCode accepts the current OR immediately-previous window's code, so
// a scan made right as the code rotates (or with a little network latency) still
// succeeds. Constant-time compare.
func (s *Service) validCheckinCode(runID uuid.UUID, code string, now time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return false
	}
	w := now.Unix() / checkinWindowSecs
	for _, win := range []int64{w, w - 1} {
		if hmac.Equal([]byte(s.checkinCode(runID, win)), []byte(code)) {
			return true
		}
	}
	return false
}

// OpenCheckin / CloseCheckin flip a run's check-in (organiser action; the
// handler enforces admin). Returns the refreshed run.
func (s *Service) SetCheckinOpen(ctx context.Context, runID uuid.UUID, open bool) (*Run, error) {
	if err := s.repo.SetCheckinOpen(ctx, runID, open); err != nil {
		return nil, err
	}
	return s.repo.GetRun(ctx, runID)
}

// MemberChapterAttendance returns a member's attendance record within a chapter.
func (s *Service) MemberChapterAttendance(ctx context.Context, chapterID uuid.UUID, userID string) (*ChapterAttendanceSummary, error) {
	return s.repo.MemberChapterAttendance(ctx, chapterID, userID)
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
	run, err := s.repo.ScheduleRun(ctx, n)
	if err == nil && s.notify != nil {
		s.notify.NotifyChapterMembers(ctx, run.ChapterID, run.CreatedBy,
			"New run scheduled", run.Title, map[string]string{"type": "run", "run_id": run.ID.String()})
	}
	return run, err
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
	runs, err := s.repo.BulkSchedule(ctx, base, times)
	if err == nil && s.notify != nil && len(runs) > 0 {
		body := base.Title
		if len(runs) > 1 {
			body = base.Title + " · " + strconv.Itoa(len(runs)) + " runs"
		}
		s.notify.NotifyChapterMembers(ctx, base.ChapterID, base.CreatedBy,
			"New runs scheduled", body, map[string]string{"type": "run", "chapter_id": base.ChapterID.String()})
	}
	return runs, err
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

// CheckIn records attendance for a run. markedBy is nil for a self check-in, or
// the admin's id when marking someone else.
//
//   - Admin marking a member (markedBy != nil): trusted, no code needed,
//     source 'admin'. Works whether or not check-in is "open".
//   - Self check-in (markedBy == nil): the trust path. Requires check-in to be
//     OPEN and a valid rotating code (scanned from the organiser's QR or typed).
//     This is what closes the couch-check-in loophole, so source is 'qr'.
func (s *Service) CheckIn(ctx context.Context, runID uuid.UUID, userID string, markedBy *string, code string) (*Run, error) {
	run, err := s.repo.GetRun(ctx, runID)
	if err != nil {
		return nil, err
	}

	source := "admin"
	if markedBy == nil {
		// Self check-in must prove presence via the live code.
		if !run.CheckinOpen {
			return nil, ValidationError{Msg: "check-in isn't open yet — ask the organiser to start it"}
		}
		if !s.validCheckinCode(run.ID, code, time.Now()) {
			return nil, ValidationError{Msg: "that code has expired — scan the organiser's QR again"}
		}
		source = "qr"
	}

	if err := s.repo.CheckIn(ctx, run.ID, run.ChapterID, userID, markedBy, source); err != nil {
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
