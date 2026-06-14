package challenges

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/leaderboard"
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

// notifier fans challenge events to members/users (local interface, nil-safe).
type notifier interface {
	NotifyChapterMembers(ctx context.Context, chapterID uuid.UUID, exclude, title, body string, data map[string]string)
	NotifyUsers(ctx context.Context, userIDs []string, title, body string, data map[string]string)
}

// Service holds challenge business logic: durable data in Postgres (repo) plus
// the fast Redis leaderboard (board), with user names resolved via names.
type Service struct {
	repo   *Repository
	board  *leaderboard.Leaderboard
	names  nameLookup
	notify notifier
}

// NewService wires the service together.
func NewService(repo *Repository, board *leaderboard.Leaderboard, names nameLookup, notify notifier) *Service {
	return &Service{repo: repo, board: board, names: names, notify: notify}
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

	ch, err := s.repo.Create(ctx, c)
	if err == nil && s.notify != nil && ch.ChapterID != nil {
		// Chapter-scoped challenges ping that chapter's members.
		s.notify.NotifyChapterMembers(ctx, *ch.ChapterID, ch.CreatorID,
			"New challenge", ch.Title, map[string]string{"type": "challenge", "challenge_id": ch.ID.String()})
	}
	return ch, err
}

// Get returns a challenge with the user's participation state.
func (s *Service) Get(ctx context.Context, userID string, id uuid.UUID) (*Challenge, error) {
	return s.repo.Get(ctx, userID, id)
}

// List returns visible challenges (browse) or just the user's (joinedOnly).
func (s *Service) List(ctx context.Context, userID string, joinedOnly bool) ([]Challenge, error) {
	return s.repo.List(ctx, userID, joinedOnly)
}

// PublicList lists live/upcoming challenges for guests (no auth): public ones,
// plus city-visibility ones for the guest's chosen city. An unknown type filter
// is ignored rather than erroring — it's a browse, not a write.
func (s *Service) PublicList(ctx context.Context, city, search, ctype string) ([]PublicEntry, error) {
	if ctype != TypeDistance && ctype != TypeDays && ctype != TypeStreak {
		ctype = ""
	}
	return s.repo.PublicList(ctx, strings.TrimSpace(city), strings.TrimSpace(search), ctype)
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
	now := time.Now()
	if !ch.Joined { // joining is only open before the challenge starts
		if !now.Before(ch.EndDate) {
			return nil, ValidationError{Msg: "this challenge has ended"}
		}
		if !now.Before(ch.StartDate) {
			return nil, ValidationError{Msg: "joining has closed — the challenge has already started"}
		}
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
	// Leaving closes at the organiser's lock date, or at the start if none set.
	cutoff := ch.StartDate
	if ch.LockDate != nil {
		cutoff = *ch.LockDate
	}
	if !time.Now().Before(cutoff) {
		return nil, ValidationError{Msg: "leaving is closed for this challenge"}
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

// UpdateInput carries the organiser's edit. Nil pointers mean "keep current";
// the service merges onto the stored row and re-validates the result.
type UpdateInput struct {
	Title       *string
	Description *string
	TargetKM    *float64
	TargetDays  *int
	StartDate   *time.Time
	EndDate     *time.Time
	LockDate    *time.Time
}

// ErrForbidden means the caller isn't allowed to manage this challenge.
var ErrForbidden = errors.New("only the challenge organiser can do that")

// Update lets the organiser edit a challenge's details — but only before it
// starts. Once runners are on the course the goal posts are locked. Type and
// visibility never change (they'd reshape who can see it / what progress means).
func (s *Service) Update(ctx context.Context, userID string, id uuid.UUID, in UpdateInput) (*Challenge, error) {
	ch, err := s.repo.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if ch.CreatorID != userID {
		return nil, ErrForbidden
	}
	if !time.Now().Before(ch.StartDate) {
		return nil, ValidationError{Msg: "editing is closed — the challenge has already started"}
	}

	// Merge the edit onto the current values.
	upd := ChallengeUpdate{
		Title:       ch.Title,
		Description: ch.Description,
		TargetKM:    ch.TargetKM,
		TargetDays:  ch.TargetDays,
		StartDate:   ch.StartDate,
		EndDate:     ch.EndDate,
		LockDate:    ch.LockDate,
	}
	if in.Title != nil {
		upd.Title = strings.TrimSpace(*in.Title)
	}
	if in.Description != nil {
		upd.Description = strings.TrimSpace(*in.Description)
	}
	if in.TargetKM != nil {
		upd.TargetKM = in.TargetKM
	}
	if in.TargetDays != nil {
		upd.TargetDays = in.TargetDays
	}
	if in.StartDate != nil {
		upd.StartDate = *in.StartDate
	}
	if in.EndDate != nil {
		upd.EndDate = *in.EndDate
	}
	if in.LockDate != nil {
		upd.LockDate = in.LockDate
	}

	// Same rules as create.
	if upd.Title == "" {
		return nil, ValidationError{Msg: "title is required"}
	}
	if !upd.EndDate.After(upd.StartDate) {
		return nil, ValidationError{Msg: "end date must be after start date"}
	}
	switch ch.Type {
	case TypeDistance:
		if upd.TargetKM == nil || *upd.TargetKM <= 0 {
			return nil, ValidationError{Msg: "a positive target_km is required for a distance challenge"}
		}
	case TypeDays, TypeStreak:
		if upd.TargetDays == nil || *upd.TargetDays <= 0 {
			return nil, ValidationError{Msg: "a positive target_days is required for a days/streak challenge"}
		}
	}

	if err := s.repo.Update(ctx, id, upd); err != nil {
		return nil, err
	}

	// Heads-up to everyone already in (except the organiser editing).
	if s.notify != nil {
		if ids, err := s.repo.ParticipantUserIDs(ctx, id); err == nil {
			others := ids[:0]
			for _, pid := range ids {
				if pid != userID {
					others = append(others, pid)
				}
			}
			if len(others) > 0 {
				s.notify.NotifyUsers(ctx, others, "Challenge updated",
					"“"+upd.Title+"” was updated by the organiser — check the new details.",
					map[string]string{"type": "challenge", "challenge_id": id.String()})
			}
		}
	}

	return s.repo.Get(ctx, userID, id)
}

// RecordRunProgress is the GPS hook: every saved run (recorded live or GPX
// import) credits ALL of the runner's active challenges — km for distance ones,
// a recompute of run-days / streaks for the others. Best-effort — errors are
// logged so a leaderboard hiccup never fails a run upload.
func (s *Service) RecordRunProgress(ctx context.Context, userID string, runStart time.Time, distanceM float64, _ uuid.UUID) {
	if distanceM <= 0 {
		return
	}
	km := distanceM / 1000.0
	memberships, err := s.repo.ActiveMemberships(ctx, userID, runStart)
	if err != nil {
		log.Printf("challenges: load active memberships failed: %v", err)
		return
	}
	for _, m := range memberships {
		var score float64
		var ok bool
		switch m.Type {
		case TypeDistance:
			score, ok, err = s.repo.AddProgressKM(ctx, m.ID, userID, km)
		default: // days / streak: recompute from the activities table
			var days int
			days, ok, err = s.repo.SyncDayProgress(ctx, m.ID, userID, m.Type, m.StartDate, m.EndDate)
			score = float64(days)
		}
		if err != nil || !ok {
			if err != nil {
				log.Printf("challenges: credit %s challenge failed: %v", m.Type, err)
			}
			continue
		}
		if err := s.board.SetScore(ctx, m.ID, userID, score); err != nil {
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

// ChapterLeaderboard ranks the chapters competing in a challenge by their
// members' combined progress (the org-wide "which club is winning" board).
// Computed straight from Postgres — cheap, and not worth a Redis cache.
func (s *Service) ChapterLeaderboard(ctx context.Context, challengeID uuid.UUID) ([]ChapterEntry, error) {
	return s.repo.ChapterScores(ctx, challengeID)
}

// scoreOf returns the leaderboard score for a challenge given a user's
// participation: km for a distance challenge, days otherwise.
func scoreOf(ch *Challenge) float64 {
	if ch.Type == TypeDistance {
		return ch.ProgressKM
	}
	return float64(ch.ProgressDays)
}
