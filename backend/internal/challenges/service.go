package challenges

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/avinash/virtual-run-tracker/backend/internal/leaderboard"
)

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// LeaderboardEntry pairs a leaderboard rank with the user's display name, so the
// API can show "Alice — 12.3 km — #1" without the client doing extra lookups.
type LeaderboardEntry struct {
	UserID      string  `json:"user_id"`
	DisplayName string  `json:"display_name"`
	DistanceM   float64 `json:"distance_m"`
	Rank        int     `json:"rank"`
}

// nameLookup resolves user display names (implemented by the users repository).
// We depend on a small interface, not the concrete repo, to avoid coupling the
// challenges package to the users package's full surface.
type nameLookup interface {
	DisplayNames(ctx context.Context, ids []string) (map[string]string, error)
}

// Service holds challenge business logic: durable data in Postgres (repo) plus
// the fast Redis leaderboard (board), with user names resolved via names.
type Service struct {
	repo  *Repository
	board *leaderboard.Leaderboard
	names nameLookup
}

// NewService wires the service together.
func NewService(repo *Repository, board *leaderboard.Leaderboard, names nameLookup) *Service {
	return &Service{repo: repo, board: board, names: names}
}

// Create validates input and creates a challenge.
func (s *Service) Create(ctx context.Context, c NewChallenge) (*Challenge, error) {
	c.Name = strings.TrimSpace(c.Name)
	c.Description = strings.TrimSpace(c.Description)
	if c.Name == "" {
		return nil, ValidationError{Msg: "name is required"}
	}
	if c.TargetDistanceM <= 0 {
		return nil, ValidationError{Msg: "target distance must be positive"}
	}
	if !c.EndsAt.After(c.StartsAt) {
		return nil, ValidationError{Msg: "end time must be after start time"}
	}
	return s.repo.Create(ctx, c)
}

// Get returns a challenge with the user's membership state.
func (s *Service) Get(ctx context.Context, userID string, id uuid.UUID) (*Challenge, error) {
	return s.repo.Get(ctx, userID, id)
}

// List returns all challenges (browse) or just the user's (joinedOnly).
func (s *Service) List(ctx context.Context, userID string, joinedOnly bool) ([]Challenge, error) {
	return s.repo.List(ctx, userID, joinedOnly)
}

// Join adds the user to a challenge and registers them on the leaderboard at
// their current progress (0 for a fresh join). Returns the challenge state.
func (s *Service) Join(ctx context.Context, userID string, challengeID uuid.UUID) (*Challenge, error) {
	ch, err := s.repo.Get(ctx, userID, challengeID)
	if err != nil {
		return nil, err // ErrNotFound bubbles up
	}
	if _, err := s.repo.Join(ctx, challengeID, userID); err != nil {
		return nil, err
	}
	// Put the user on the board (score 0 if new) so they appear ranked even
	// before their first run.
	if err := s.board.SetScore(ctx, challengeID, userID, ch.ProgressDistanceM); err != nil {
		// Non-fatal: Postgres has the membership; the board can be rebuilt.
		log.Printf("challenges: leaderboard SetScore on join failed: %v", err)
	}
	return s.repo.Get(ctx, userID, challengeID)
}

// RecordRunProgress is called after a run is saved. It credits the run's
// distance to every challenge the user is in that was active at the run's start,
// updating both Postgres (durable) and Redis (fast). Errors are logged, not
// returned, so a leaderboard hiccup never fails the user's run upload.
func (s *Service) RecordRunProgress(ctx context.Context, userID string, runStart time.Time, distanceM float64) {
	if distanceM <= 0 {
		return
	}
	ids, err := s.repo.ActiveMembershipsForUser(ctx, userID, runStart)
	if err != nil {
		log.Printf("challenges: load active memberships failed: %v", err)
		return
	}
	for _, challengeID := range ids {
		total, ok, err := s.repo.AddProgress(ctx, challengeID, userID, distanceM)
		if err != nil || !ok {
			if err != nil {
				log.Printf("challenges: AddProgress failed: %v", err)
			}
			continue
		}
		// Mirror the new authoritative total into Redis (SetScore, not Incr, so
		// the two can't drift even if a prior update was missed).
		if err := s.board.SetScore(ctx, challengeID, userID, total); err != nil {
			log.Printf("challenges: leaderboard SetScore failed: %v", err)
		}
	}
}

// Leaderboard returns the top entries for a challenge, with display names. It
// reads from Redis (fast); if Redis is empty for this challenge (e.g. after a
// restart), it transparently rebuilds the board from Postgres first.
func (s *Service) Leaderboard(ctx context.Context, challengeID uuid.UUID, limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	entries, err := s.board.Top(ctx, challengeID, limit)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		// Self-heal: rebuild from the durable source, then read again.
		scores, err := s.repo.Scores(ctx, challengeID)
		if err != nil {
			return nil, err
		}
		if len(scores) > 0 {
			if err := s.board.Rebuild(ctx, challengeID, scores); err != nil {
				return nil, err
			}
			entries, err = s.board.Top(ctx, challengeID, limit)
			if err != nil {
				return nil, err
			}
		}
	}

	// Resolve display names for the ranked users in one batch query.
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.UserID
	}
	names, err := s.names.DisplayNames(ctx, ids)
	if err != nil {
		return nil, err
	}

	out := make([]LeaderboardEntry, len(entries))
	for i, e := range entries {
		out[i] = LeaderboardEntry{
			UserID:      e.UserID,
			DisplayName: names[e.UserID],
			DistanceM:   e.DistanceM,
			Rank:        e.Rank,
		}
	}
	return out, nil
}
