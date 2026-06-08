package runlog

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// Service holds run-logging business logic.
type Service struct{ repo *Repository }

// NewService wires the service to its repository.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// ist is the reference timezone for period boundaries (the audience is in India).
var ist = mustLoad("Asia/Kolkata")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

// Log validates and records a run for a chapter the user actively belongs to.
func (s *Service) Log(ctx context.Context, userID string, n NewLog) (*RunLog, error) {
	if n.DistanceKM <= 0 {
		return nil, ValidationError{Msg: "distance must be greater than 0"}
	}
	if n.DistanceKM > 500 {
		return nil, ValidationError{Msg: "that distance looks too large"}
	}
	ranOn, err := time.ParseInLocation("2006-01-02", n.RanOn, ist)
	if err != nil {
		return nil, ValidationError{Msg: "ran_on must be a YYYY-MM-DD date"}
	}
	today := startOfDay(time.Now())
	if ranOn.After(today) {
		return nil, ValidationError{Msg: "you can't log a run in the future"}
	}
	if ranOn.Before(today.AddDate(0, 0, -90)) {
		return nil, ValidationError{Msg: "runs older than 90 days can't be logged"}
	}
	member, err := s.repo.IsActiveMember(ctx, n.ChapterID, userID)
	if err != nil {
		return nil, err
	}
	if !member {
		return nil, ValidationError{Msg: "you must be an active member of this club to log a run for it"}
	}
	return s.repo.Create(ctx, userID, n)
}

// MyLogs returns the user's recent logs.
func (s *Service) MyLogs(ctx context.Context, userID string) ([]RunLog, error) {
	return s.repo.MyLogs(ctx, userID, 50)
}

// Leaderboard returns a chapter's rolling board for the given period
// (daily | weekly | monthly | alltime).
func (s *Service) Leaderboard(ctx context.Context, chapterID uuid.UUID, period string) ([]BoardEntry, error) {
	from, to, ok := periodRange(period, time.Now())
	if !ok {
		return nil, ValidationError{Msg: "period must be daily, weekly, monthly or alltime"}
	}
	return s.repo.Board(ctx, chapterID, from, to)
}

func startOfDay(t time.Time) time.Time {
	n := t.In(ist)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, ist)
}

// periodRange returns inclusive YYYY-MM-DD bounds for a period, in IST. Both nil
// = all-time. Week starts Monday; month is the calendar month.
func periodRange(period string, now time.Time) (from, to *string, ok bool) {
	today := startOfDay(now)
	fmtDate := func(t time.Time) *string { s := t.Format("2006-01-02"); return &s }
	t := fmtDate(today)
	switch period {
	case "daily":
		return fmtDate(today), t, true
	case "weekly":
		wd := int(today.Weekday()) // Sunday = 0
		if wd == 0 {
			wd = 7
		}
		return fmtDate(today.AddDate(0, 0, -(wd - 1))), t, true
	case "monthly":
		return fmtDate(time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, ist)), t, true
	case "alltime":
		return nil, nil, true
	default:
		return nil, nil, false
	}
}
