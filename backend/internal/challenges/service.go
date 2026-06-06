package challenges

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/avinash/virtual-run-tracker/backend/internal/leaderboard"
)

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// LeaderboardEntry pairs a rank with the participant's display name and score
// (km for distance challenges, days otherwise).
type LeaderboardEntry struct {
	UserID      string  `json:"user_id"`
	DisplayName string  `json:"display_name"`
	Score       float64 `json:"score"`
	Rank        int     `json:"rank"`
}

// nameLookup resolves user display names (implemented by the users repository).
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

var validTypes = map[string]bool{TypeDistance: true, TypeDays: true, TypeStreak: true}
var validVisibilities = map[string]bool{
	VisibilityPublic: true, VisibilityChapter: true, VisibilityCity: true, VisibilityOrg: true,
}

// Create validates the typed goal + visibility scoping and creates a challenge.
func (s *Service) Create(ctx context.Context, c NewChallenge) (*Challenge, error) {
	c.Title = strings.TrimSpace(c.Title)
	c.Description = strings.TrimSpace(c.Description)
	if c.Title == "" {
		return nil, ValidationError{Msg: "title is required"}
	}
	if !validTypes[c.Type] {
		return nil, ValidationError{Msg: "type must be one of distance, days, streak"}
	}
	if !validVisibilities[c.Visibility] {
		return nil, ValidationError{Msg: "visibility must be one of public, chapter, city, org"}
	}
	if !c.EndDate.After(c.StartDate) {
		return nil, ValidationError{Msg: "end date must be after start date"}
	}

	// Goal target must match the type.
	switch c.Type {
	case TypeDistance:
		if c.TargetKM == nil || *c.TargetKM <= 0 {
			return nil, ValidationError{Msg: "a positive target_km is required for a distance challenge"}
		}
	case TypeDays, TypeStreak:
		if c.TargetDays == nil || *c.TargetDays <= 0 {
			return nil, ValidationError{Msg: "a positive target_days is required for a days/streak challenge"}
		}
	}

	// Scoping must carry what its visibility needs.
	switch c.Visibility {
	case VisibilityCity:
		if c.City == nil || strings.TrimSpace(*c.City) == "" {
			return nil, ValidationError{Msg: "city is required for a city-visibility challenge"}
		}
	case VisibilityChapter:
		if c.ChapterID == nil {
			return nil, ValidationError{Msg: "chapter_id is required for a chapter-visibility challenge"}
		}
	case VisibilityOrg:
		if c.OrgID == nil {
			return nil, ValidationError{Msg: "org_id is required for an org-visibility challenge"}
		}
	}

	return s.repo.Create(ctx, c)
}

// Get returns a challenge with the user's participation state.
func (s *Service) Get(ctx context.Context, userID string, id uuid.UUID) (*Challenge, error) {
	return s.repo.Get(ctx, userID, id)
}

// List returns visible challenges (browse) or just the user's (joinedOnly).
func (s *Service) List(ctx context.Context, userID string, joinedOnly bool) ([]Challenge, error) {
	return s.repo.List(ctx, userID, joinedOnly)
}

// ErrPaymentRequired means the challenge has a join fee that hasn't been paid.
var ErrPaymentRequired = errors.New("payment required to join this challenge")

// Join adds the user as an individual participant and registers them on the
// leaderboard at their current score. If the challenge has a join fee, `paid`
// must be true (the client completes the mock payment first).
func (s *Service) Join(ctx context.Context, userID string, challengeID uuid.UUID, paid bool) (*Challenge, error) {
	ch, err := s.repo.Get(ctx, userID, challengeID)
	if err != nil {
		return nil, err
	}
	hasFee := ch.JoinFee != nil && *ch.JoinFee > 0
	if hasFee && !paid && !ch.Joined {
		return nil, ErrPaymentRequired
	}
	if _, err := s.repo.JoinAsUser(ctx, challengeID, userID, hasFee); err != nil {
		return nil, err
	}
	if err := s.board.SetScore(ctx, challengeID, userID, scoreOf(ch)); err != nil {
		log.Printf("challenges: leaderboard SetScore on join failed: %v", err)
	}
	return s.repo.Get(ctx, userID, challengeID)
}

// Leave removes the user's participation, allowed only before the lock date (if
// the organiser set one). The leaderboard entry is removed too.
func (s *Service) Leave(ctx context.Context, userID string, challengeID uuid.UUID) (*Challenge, error) {
	ch, err := s.repo.Get(ctx, userID, challengeID)
	if err != nil {
		return nil, err
	}
	if ch.LockDate != nil && !time.Now().Before(*ch.LockDate) {
		return nil, ValidationError{Msg: "leaving is locked for this challenge"}
	}
	if _, err := s.repo.LeaveAsUser(ctx, challengeID, userID); err != nil {
		return nil, err
	}
	if err := s.board.Remove(ctx, challengeID, userID); err != nil {
		log.Printf("challenges: leaderboard Remove on leave failed: %v", err)
	}
	return s.repo.Get(ctx, userID, challengeID)
}

// JoinAsChapter records a club's participation in a challenge. Authorization
// (the caller is an admin of that chapter) is enforced by the handler.
func (s *Service) JoinAsChapter(ctx context.Context, challengeID, chapterID uuid.UUID) error {
	_, err := s.repo.JoinAsChapter(ctx, challengeID, chapterID)
	return err
}

// SubmitProof records a Phase 1 proof. The challenge must exist (and be visible
// enough to fetch); progress isn't credited until an admin verifies it.
func (s *Service) SubmitProof(ctx context.Context, userID string, challengeID uuid.UUID, stravaLink, screenshotURL *string, kmClaimed *float64, proofDate *string) (*Proof, error) {
	if (stravaLink == nil || strings.TrimSpace(*stravaLink) == "") &&
		(screenshotURL == nil || strings.TrimSpace(*screenshotURL) == "") {
		return nil, ValidationError{Msg: "a strava_link or screenshot_url is required"}
	}
	// Without a Strava link to read the date from, the proof's date is required.
	if (stravaLink == nil || strings.TrimSpace(*stravaLink) == "") &&
		(proofDate == nil || strings.TrimSpace(*proofDate) == "") {
		return nil, ValidationError{Msg: "a date is required when there's no Strava link"}
	}
	if _, err := s.repo.Get(ctx, userID, challengeID); err != nil {
		return nil, err // ErrNotFound bubbles up
	}
	return s.repo.SubmitProof(ctx, challengeID, userID, stravaLink, screenshotURL, kmClaimed, proofDate)
}

// ListProof returns a challenge's proof submissions (admin review queue).
func (s *Service) ListProof(ctx context.Context, challengeID uuid.UUID) ([]Proof, error) {
	return s.repo.ListProof(ctx, challengeID)
}

// VerifyProof marks a proof verified and, the first time, credits the submitter's
// progress (km for distance challenges, +1 day otherwise) and updates the board.
// Re-verifying an already-verified proof is a no-op (no double credit).
func (s *Service) VerifyProof(ctx context.Context, verifierID string, proofID uuid.UUID) (*Proof, error) {
	proof, firstTime, err := s.repo.MarkProofVerified(ctx, proofID, verifierID)
	if err != nil {
		return nil, err
	}
	if !firstTime {
		return proof, nil // already verified earlier; nothing to credit
	}

	ch, err := s.repo.Get(ctx, proof.UserID, proof.ChallengeID)
	if err != nil {
		return nil, err
	}

	var newScore float64
	switch ch.Type {
	case TypeDistance:
		km := 0.0
		if proof.KMClaimed != nil {
			km = *proof.KMClaimed
		}
		total, ok, err := s.repo.AddProgressKM(ctx, proof.ChallengeID, proof.UserID, km)
		if err != nil {
			return nil, err
		}
		if !ok { // submitter hadn't joined — verifying a proof implies participation
			if _, err := s.repo.JoinAsUser(ctx, proof.ChallengeID, proof.UserID, true); err != nil {
				return nil, err
			}
			total, _, err = s.repo.AddProgressKM(ctx, proof.ChallengeID, proof.UserID, km)
			if err != nil {
				return nil, err
			}
		}
		newScore = total
	default: // days / streak
		days, ok, err := s.repo.AddProgressDay(ctx, proof.ChallengeID, proof.UserID)
		if err != nil {
			return nil, err
		}
		if !ok {
			if _, err := s.repo.JoinAsUser(ctx, proof.ChallengeID, proof.UserID, true); err != nil {
				return nil, err
			}
			days, _, err = s.repo.AddProgressDay(ctx, proof.ChallengeID, proof.UserID)
			if err != nil {
				return nil, err
			}
		}
		newScore = float64(days)
	}

	if err := s.board.SetScore(ctx, proof.ChallengeID, proof.UserID, newScore); err != nil {
		log.Printf("challenges: leaderboard SetScore on verify failed: %v", err)
	}
	return proof, nil
}

// RecordRunProgress is the GPS hook (Phase 3): a saved run credits its distance
// (converted to km) to the user's active DISTANCE challenges. Best-effort —
// errors are logged so a leaderboard hiccup never fails a run upload.
func (s *Service) RecordRunProgress(ctx context.Context, userID string, runStart time.Time, distanceM float64) {
	if distanceM <= 0 {
		return
	}
	km := distanceM / 1000.0
	ids, err := s.repo.ActiveDistanceMemberships(ctx, userID, runStart)
	if err != nil {
		log.Printf("challenges: load active memberships failed: %v", err)
		return
	}
	for _, challengeID := range ids {
		total, ok, err := s.repo.AddProgressKM(ctx, challengeID, userID, km)
		if err != nil || !ok {
			if err != nil {
				log.Printf("challenges: AddProgressKM failed: %v", err)
			}
			continue
		}
		if err := s.board.SetScore(ctx, challengeID, userID, total); err != nil {
			log.Printf("challenges: leaderboard SetScore failed: %v", err)
		}
	}
}

// Leaderboard returns the top entries for a challenge with display names,
// reading from Redis and self-healing from Postgres if the board is empty.
func (s *Service) Leaderboard(ctx context.Context, challengeID uuid.UUID, limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	entries, err := s.board.Top(ctx, challengeID, limit)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
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

	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.Member
	}
	namesByID, err := s.names.DisplayNames(ctx, ids)
	if err != nil {
		return nil, err
	}

	out := make([]LeaderboardEntry, len(entries))
	for i, e := range entries {
		out[i] = LeaderboardEntry{
			UserID:      e.Member,
			DisplayName: namesByID[e.Member],
			Score:       e.Score,
			Rank:        e.Rank,
		}
	}
	return out, nil
}

// scoreOf returns the leaderboard score for a challenge given a user's
// participation: km for a distance challenge, days otherwise.
func scoreOf(ch *Challenge) float64 {
	if ch.Type == TypeDistance {
		return ch.ProgressKM
	}
	return float64(ch.ProgressDays)
}
