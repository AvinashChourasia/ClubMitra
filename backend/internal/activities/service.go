package activities

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/pkg/geo"
)

// elevationNoiseThresholdM ignores altitude jitter below this many meters when
// summing climb. Raw GPS altitude is noisy; 1m is a common, conservative floor.
const elevationNoiseThresholdM = 1.0

// Sensible bounds so a buggy client can't insert absurd data.
const (
	minPoints   = 2
	maxPoints   = 100_000 // ~28h at 1Hz; generous but bounded
)

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// Service holds activity business logic.
// RecordedHook is called after a run is successfully stored. We use it to credit
// challenge progress WITHOUT this package importing the challenges package — main
// wires the two together. The activities package stays unaware of challenges.
type RecordedHook func(ctx context.Context, userID string, runStart time.Time, distanceM float64, activityID uuid.UUID)

type Service struct {
	repo     *Repository
	onRecord RecordedHook
}

// NewService wires the service to the repository.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// SetRecordedHook registers a callback to run after each saved activity. Optional
// — if unset, recording simply skips it.
func (s *Service) SetRecordedHook(h RecordedHook) {
	s.onRecord = h
}

// Record validates a run's GPS points, computes the Go-side stats, and stores
// it. PostGIS computes distance & pace inside the repository; here we handle
// duration and elevation (plain arithmetic, no spatial math needed).
//
// countTowardChallenges lets the caller exclude a run (a warm-up, a treadmill
// test) from challenge progress. The run is still stored either way — only the
// challenge-credit hook is skipped.
func (s *Service) Record(ctx context.Context, userID string, points []geo.Point, countTowardChallenges bool, pausedS float64) (*Activity, error) {
	if len(points) < minPoints {
		return nil, ValidationError{Msg: "a run needs at least 2 GPS points"}
	}
	if len(points) > maxPoints {
		return nil, ValidationError{Msg: "too many GPS points"}
	}
	// Points must be chronologically ordered; otherwise duration/route are
	// meaningless. We reject rather than silently sort, so a buggy client is
	// caught instead of masked.
	for i := 1; i < len(points); i++ {
		if points[i].Timestamp.Before(points[i-1].Timestamp) {
			return nil, ValidationError{Msg: "GPS points must be ordered by time"}
		}
	}

	duration := geo.Duration(points)
	if duration <= 0 {
		return nil, ValidationError{Msg: "run duration must be positive"}
	}

	// Moving time = elapsed minus auto-paused time. Guard against a bogus paused
	// value that would zero/negate the duration by falling back to elapsed.
	movingDuration := duration - time.Duration(pausedS*float64(time.Second))
	if movingDuration < time.Second {
		movingDuration = duration
	}

	// Seconds-from-start of each point, aligned 1:1 with the route's vertices —
	// the client uses these to colour the route by pace.
	start := points[0].Timestamp
	offsets := make([]float64, len(points))
	for i, p := range points {
		offsets[i] = p.Timestamp.Sub(start).Seconds()
	}

	na := NewActivity{
		UserID:         userID,
		StartedAt:      points[0].Timestamp,
		EndedAt:        points[len(points)-1].Timestamp,
		DurationS:      int(movingDuration / time.Second),
		ElevationGainM: geo.ElevationGain(points, elevationNoiseThresholdM),
		RouteEWKT:      geo.LineStringEWKT(points),
		PointOffsets:   offsets,
	}
	act, err := s.repo.Create(ctx, na)
	if err != nil {
		return nil, err
	}

	// Credit challenge progress (best-effort; the hook logs its own errors and
	// must never fail the run upload). Skipped when the user opted this run out.
	if countTowardChallenges && s.onRecord != nil {
		s.onRecord(ctx, userID, act.StartedAt, act.DistanceM, act.ID)
	}
	return act, nil
}

// List returns a user's activities with simple bounds on pagination.
func (s *Service) List(ctx context.Context, userID string, limit, offset int) ([]Activity, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.ListByUser(ctx, userID, limit, offset)
}

// Get returns a single activity owned by the user (or ErrNotFound).
func (s *Service) Get(ctx context.Context, userID string, id uuid.UUID) (*Activity, error) {
	return s.repo.GetByID(ctx, userID, id)
}

// Stats returns the user's all-time aggregate stats.
func (s *Service) Stats(ctx context.Context, userID string) (*Stats, error) {
	return s.repo.Stats(ctx, userID)
}

// RouteWithMeta returns the run's route GeoJSON geometry plus per-vertex
// seconds-from-start offsets (nil for older runs).
func (s *Service) RouteWithMeta(ctx context.Context, userID string, id uuid.UUID) (string, []float64, error) {
	return s.repo.RouteWithMeta(ctx, userID, id)
}

// ErrForbidden marks a feed request from a non-member.
var ErrForbidden = errors.New("forbidden")

// ChapterFeed returns a club's recent member runs — members only.
func (s *Service) ChapterFeed(ctx context.Context, userID string, chapterID uuid.UUID) ([]FeedItem, error) {
	ok, err := s.repo.IsChapterMember(ctx, chapterID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrForbidden
	}
	return s.repo.ChapterFeed(ctx, chapterID, 30)
}

// CityLeaderboard ranks GPS-verified runners in a city over a rolling window
// (week | month | all). An empty city defaults to the requester's own city; a
// runner with no city set gets an empty board rather than an error.
func (s *Service) CityLeaderboard(ctx context.Context, userID, city, period string) (*CityBoardView, error) {
	if city == "" {
		c, err := s.repo.UserCity(ctx, userID)
		if err != nil {
			return nil, err
		}
		city = c
	}
	if period != "today" && period != "week" && period != "month" && period != "all" {
		period = "week"
	}
	view := &CityBoardView{City: city, Period: period, Entries: []CityBoardEntry{}}
	if city == "" {
		return view, nil // no city → nothing to rank
	}
	entries, err := s.repo.CityBoardEntries(ctx, city, cityPeriodFrom(period, time.Now()))
	if err != nil {
		return nil, err
	}
	view.Entries = entries
	return view, nil
}

// ist is the reference timezone for "today" (the audience is in India), so the
// day boundary matches what users expect rather than UTC midnight.
var ist = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		return time.FixedZone("IST", 5*3600+30*60)
	}
	return loc
}()

// cityPeriodFrom maps a period to the rolling-window start. "today" is midnight
// IST; week/month are rolling windows; "all" returns the zero time so every
// activity qualifies.
func cityPeriodFrom(period string, now time.Time) time.Time {
	switch period {
	case "today":
		n := now.In(ist)
		return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, ist)
	case "week":
		return now.AddDate(0, 0, -7)
	case "month":
		return now.AddDate(0, 0, -30)
	default:
		return time.Time{}
	}
}
